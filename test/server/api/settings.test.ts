import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("settings API", () => {
  const api = useApi();

  test("GET /v1/settings returns the defaults", async () => {
    const { status, body } = await api.call("/v1/settings");

    expect(status).toBe(200);
    expect(body).toMatchObject({
      name: "settings",
      tasksInbox: "Inbox.md",
      tailnet: {},
    });
    expect(body.etag).toBeTruthy();
    expect(body.envOverrides).toBeUndefined();
  });

  test("PATCH changes only the masked fields", async () => {
    const { status, body } = await api.call("/v1/settings?updateMask=tasksInbox", "PATCH", {
      tasksInbox: "Tasks/Inbox.md",
      timeZone: "Asia/Tokyo",
    });

    expect(status).toBe(200);
    expect(body).toMatchObject({ tasksInbox: "Tasks/Inbox.md" });
    expect(body.timeZone).toBeUndefined();
    expect(body.restartRequired).toBeUndefined();
  });

  test("a time zone change says it needs a restart", async () => {
    const { body } = await api.call("/v1/settings", "PATCH", { timeZone: "Europe/London" });

    expect(body).toMatchObject({ timeZone: "Europe/London", restartRequired: ["time_zone"] });
  });

  test("an unknown time zone is rejected", async () => {
    const { status, body } = await api.call("/v1/settings", "PATCH", { timeZone: "Mars/Olympus" });

    expect(status).toBe(400);
    expect(body.message).toContain("is not a time zone");
  });

  test("an inbox outside the vault is rejected", async () => {
    for (const tasksInbox of ["../Inbox.md", "/etc/passwd", "Inbox.txt"]) {
      const { status } = await api.call("/v1/settings", "PATCH", { tasksInbox });
      expect(status).toBe(400);
    }
  });

  test("a stale etag is rejected", async () => {
    const { body: before } = await api.call("/v1/settings");
    await api.call("/v1/settings", "PATCH", { tasksInbox: "A.md" });
    await Bun.sleep(2);

    const { status } = await api.call("/v1/settings", "PATCH", {
      tasksInbox: "B.md",
      etag: before.etag,
    });

    expect(status).toBe(409);
  });

  test("tailnet sign-in can be set and cleared", async () => {
    const set = await api.call("/v1/settings", "PATCH", {
      tailnet: { proxy: "100.64.0.1", allowedLogins: ["you@github", " "] },
    });
    const cleared = await api.call("/v1/settings?updateMask=tailnet", "PATCH", {});

    expect(set.body.tailnet).toEqual({ proxy: "100.64.0.1", allowedLogins: ["you@github"] });
    expect(cleared.body.tailnet).toEqual({});
  });

  test("the inbox applies to the next new task, without a restart", async () => {
    await api.call("/v1/settings", "PATCH", { tasksInbox: "Captured.md" });

    const { body } = await api.call("/v1/tasks", "POST", { description: "Pay rent" });

    expect(body.path).toBe("Captured.md");
  });

  test("Connect serves the same service", async () => {
    const { status, body } = await api.call(
      "/dashboardify.v1.SettingsService/GetSettings",
      "POST",
      { name: "settings" },
    );

    expect(status).toBe(200);
    expect(body.tasksInbox).toBe("Inbox.md");
  });
});

describe("settings API with .env overrides", () => {
  const api = useApi({ envChange: { timeZone: "Asia/Tokyo" }, envNames: ["TZ_NAME"] });

  test("shows the environment's value and says it is overridden", async () => {
    const { body } = await api.call("/v1/settings");

    expect(body).toMatchObject({ timeZone: "Asia/Tokyo", envOverrides: ["time_zone"] });
  });

  test("refuses to change an overridden field, and says where it is set", async () => {
    const { status, body } = await api.call("/v1/settings", "PATCH", { timeZone: "Europe/London" });

    expect(status).toBe(400);
    expect(body.message).toBe(
      "time_zone is set by TZ_NAME in .env. Remove it there to change it here.",
    );
  });

  test("other fields can still change", async () => {
    const { status } = await api.call("/v1/settings", "PATCH", { tasksInbox: "Tasks.md" });

    expect(status).toBe(200);
  });
});
