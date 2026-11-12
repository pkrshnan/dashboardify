import { describe, expect, test } from "bun:test";
import { getSettings, ServiceError, updateSettings } from "../../web/api";
import { knownSection, SECTIONS, timeZones } from "../../web/settings/sections";
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

describe("sections", () => {
  test("General comes first", () => {
    expect(SECTIONS.map((s) => s.id)[0]).toBe("general");
  });

  test("the address picks a section, or none for the phone's list", () => {
    expect(knownSection("general")).toBe("general");
    expect(knownSection(undefined)).toBeUndefined();
    expect(knownSection("nope")).toBeUndefined();
  });

  test("time zones come from the runtime", () => {
    expect(timeZones()).toContain("Europe/London");
  });
});
