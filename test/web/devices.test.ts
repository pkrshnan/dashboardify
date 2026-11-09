import { describe, expect, test } from "bun:test";
import { createDevice, deleteDevice, listDevices } from "../../web/api";
import { canRevoke, closed, type Dialog, whenLabel } from "../../web/settings/device-dialog";
import { signInLink, tokenFromHash } from "../../web/settings/sign-in-link";
import { useApi } from "../server/api/helpers";

function through<T>(api: ReturnType<typeof useApi>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    api.app.request(url, init)) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

describe("devices API adapter", () => {
  const api = useApi();

  test("creates, lists and deletes, marking this device current", async () => {
    const made = await through(api, () => createDevice("secret", "iPad", "r1"));
    const listed = await through(api, () => listDevices("secret"));
    await through(api, () => deleteDevice("secret", made.name));
    const after = await through(api, () => listDevices("secret"));

    expect(made).toMatchObject({ name: "devices/ipad", displayName: "iPad" });
    expect(made.token).toMatch(/^dfy_/);
    expect(listed.map((d) => [d.displayName, d.current])).toEqual([
      ["test", true],
      ["iPad", false],
    ]);
    expect(JSON.stringify(listed)).not.toContain(made.token);
    expect(after.map((d) => d.displayName)).toEqual(["test"]);
  });
});

describe("device dialogs", () => {
  const device = { name: "devices/mac", displayName: "Mac", createTime: "", current: false };

  test("closing drops a token still on screen", () => {
    const created: Dialog = { kind: "created", displayName: "iPad", token: "dfy_secret" };

    expect(created.kind).toBe("created");
    expect(JSON.stringify(closed())).not.toContain("dfy_secret");
  });

  test("another device needs one confirmation; this one needs the tick", () => {
    expect(canRevoke({ kind: "revoke", device, understood: false })).toBe(true);
    expect(
      canRevoke({ kind: "revoke", device: { ...device, current: true }, understood: false }),
    ).toBe(false);
    expect(
      canRevoke({ kind: "revoke", device: { ...device, current: true }, understood: true }),
    ).toBe(true);
  });

  test("last-used times read naturally", () => {
    const now = new Date("2026-11-08T12:00:00");

    expect(whenLabel(undefined, now)).toBe("Never");
    expect(whenLabel(new Date("2026-11-08T11:59:30").toISOString(), now)).toBe("Just now");
    expect(whenLabel(new Date("2026-11-08T09:10:00").toISOString(), now)).toBe("Today 09:10");
    expect(whenLabel(new Date("2026-11-03T09:10:00").toISOString(), now)).toBe("3 Nov");
  });
});

describe("sign-in links", () => {
  test("carry the token in the fragment and read it back", () => {
    const link = signInLink("https://home.example.ts.net", "dfy_abc-_123");

    expect(link).toBe("https://home.example.ts.net/#token=dfy_abc-_123");
    expect(tokenFromHash(new URL(link).hash)).toBe("dfy_abc-_123");
    expect(tokenFromHash("#settings")).toBeUndefined();
    expect(tokenFromHash("#token=")).toBeUndefined();
  });
});
