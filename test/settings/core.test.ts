import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { GeneralSettings } from "../../src/settings/core";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";

let dir: string;
let store: SettingsStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "core-"));
  store = await SettingsStore.open(dir, new SecretBox(randomBytes(32)));
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("GeneralSettings", () => {
  test("starts with the defaults", () => {
    expect(new GeneralSettings(store).get()).toMatchObject({
      timeZone: undefined,
      tasksInbox: "Inbox.md",
      tailnetProxy: undefined,
      tailnetLogins: [],
    });
  });

  test("updates only the fields given, and stamps the update time", () => {
    const settings = new GeneralSettings(store, () => new Date("2026-11-08T10:00:00Z"));

    settings.update({ timeZone: "Europe/London" });
    const after = settings.update({ tailnetLogins: ["you@github"] });

    expect(after).toEqual({
      timeZone: "Europe/London",
      tasksInbox: "Inbox.md",
      tailnetProxy: undefined,
      tailnetLogins: ["you@github"],
      updateTime: "2026-11-08T10:00:00.000Z",
    });
  });

  test("an undefined optional field clears it", () => {
    const settings = new GeneralSettings(store);
    settings.update({ tailnetProxy: "gateway" });

    expect(settings.update({ tailnetProxy: undefined }).tailnetProxy).toBeUndefined();
  });

  test("refuses a time zone that isn't one", () => {
    expect(() => new GeneralSettings(store).update({ timeZone: "Mars/Olympus" })).toThrow(
      "is not a time zone",
    );
  });
});
