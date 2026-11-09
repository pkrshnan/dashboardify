import { describe, expect, test } from "bun:test";
import { getSettings, ServiceError, updateSettings } from "../../web/api";
import { lockedBy, SECTIONS, sectionFromHash, timeZones } from "../../web/settings/sections";
import { useApi } from "../server/api/helpers";

function through<T>(api: ReturnType<typeof useApi>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    api.app.request(url, init)) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

describe("settings API adapter", () => {
  const api = useApi();

  test("reads the settings with empty defaults filled in", async () => {
    const settings = await through(api, () => getSettings("secret"));

    expect(settings).toMatchObject({
      timeZone: "",
      tasksInbox: "Inbox.md",
      tailnet: { proxy: "", allowedLogins: [] },
      envOverrides: [],
      restartRequired: [],
    });
  });

  test("changes only the given fields and reports a restart", async () => {
    const zone = await through(api, () => updateSettings("secret", { timeZone: "Europe/London" }));
    const logins = await through(api, () =>
      updateSettings("secret", { tailnet: { proxy: "gateway", allowedLogins: ["you@github"] } }),
    );

    expect(zone).toMatchObject({ timeZone: "Europe/London", restartRequired: ["time_zone"] });
    expect(logins).toMatchObject({
      timeZone: "Europe/London",
      tailnet: { proxy: "gateway", allowedLogins: ["you@github"] },
      restartRequired: [],
    });
  });

  test("a refused change comes back with the server's sentence", async () => {
    const error = await through(api, () =>
      updateSettings("secret", { tasksInbox: "../outside.md" }).catch((e: unknown) => e),
    );

    expect(error).toBeInstanceOf(ServiceError);
    expect((error as Error).message).toContain("inside the vault");
  });
});

describe("settings API adapter with .env overrides", () => {
  const api = useApi({ envChange: { timeZone: "Asia/Tokyo" }, envNames: ["TZ_NAME"] });

  test("lists the overridden fields, which the page shows read-only", async () => {
    const settings = await through(api, () => getSettings("secret"));

    expect(settings.envOverrides).toEqual(["time_zone"]);
    expect(lockedBy("time_zone", settings.envOverrides)).toEqual(["TZ_NAME"]);
    expect(lockedBy("tasks_inbox", settings.envOverrides)).toBeUndefined();
  });
});

describe("sections", () => {
  test("General comes first", () => {
    expect(SECTIONS.map((s) => s.id)[0]).toBe("general");
  });

  test("the hash picks a section, or none for the phone's list", () => {
    expect(sectionFromHash("#settings/general")).toBe("general");
    expect(sectionFromHash("#settings")).toBeUndefined();
    expect(sectionFromHash("#settings/nope")).toBeUndefined();
  });

  test("tailnet is locked by both of its variables", () => {
    expect(lockedBy("tailnet", ["tailnet"])).toEqual(["TAILSCALE_PROXY", "TAILNET_USERS"]);
  });

  test("time zones come from the runtime", () => {
    expect(timeZones()).toContain("Europe/London");
  });
});
