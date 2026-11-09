import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStartup } from "../../src/server/config";
import { GeneralSettings } from "../../src/settings/core";
import { type Opened, openSettings } from "../../src/settings/startup";
import { SettingsStore } from "../../src/settings/store";

let dir: string;
let opened: Opened[] = [];
let log: string[];

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "startup-"));
  log = [];
});

afterEach(async () => {
  for (const o of opened) {
    o.store.close();
  }
  opened = [];
  await rm(dir, { recursive: true, force: true });
});

async function start(env: Record<string, string> = {}): Promise<Opened> {
  const full = { VAULT_PATH: join(dir, "vault"), DATA_PATH: join(dir, "data"), ...env };
  const o = await openSettings(loadStartup(full), full, (line) => log.push(line));
  opened.push(o);
  return o;
}

describe("openSettings", () => {
  test("a fresh install needs only VAULT_PATH", async () => {
    const { config } = await start();

    expect(config.tasksInbox).toBe("Inbox.md");
    expect(config.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(config.tailnet).toBeNull();
  });

  test("imports TZ_NAME and TASKS_INBOX once; later starts read them from Settings", async () => {
    await start({ TZ_NAME: "Europe/London", TASKS_INBOX: "Tasks.md" });
    log = [];

    const { config, overrides } = await start();

    expect(config).toMatchObject({ timeZone: "Europe/London", tasksInbox: "Tasks.md" });
    expect(overrides).toEqual([]);
    expect(log.filter((line) => line.startsWith("Imported"))).toEqual([]);
  });

  test("a variable still in the environment wins, and warns once", async () => {
    const first = await start();
    first.general.update({ timeZone: "Europe/London" });
    log = [];

    const { config, overrides } = await start({ TZ_NAME: "Asia/Tokyo" });

    expect(config.timeZone).toBe("Asia/Tokyo");
    expect(overrides).toEqual(["TZ_NAME"]);
    expect(log.filter((line) => line.includes("overrides Settings"))).toEqual([
      "TZ_NAME is set in the environment and overrides Settings. Remove it from .env.",
    ]);
  });

  test("a bad time zone in the environment stops startup and says where it came from", async () => {
    await expect(start({ TZ_NAME: "Mars/Olympus" })).rejects.toThrow(
      'TZ_NAME in the environment: "Mars/Olympus" is not a time zone',
    );
  });

  test("a bad time zone in Settings stops startup too", async () => {
    const first = await start();
    first.store.db.run("UPDATE settings SET time_zone = 'Mars/Olympus'");

    await expect(start()).rejects.toThrow('Settings time zone: "Mars/Olympus" is not a time zone');
  });

  test("tailnet sign-in changed from another connection applies without a restart", async () => {
    const { tailnet, store } = await start();
    expect(tailnet()).toBeNull();
    const cli = await SettingsStore.open(join(dir, "data"), store.box);

    new GeneralSettings(cli).update({ tailnetProxy: "100.64.0.1", tailnetLogins: ["you@github"] });

    expect(tailnet()).toEqual({ proxy: "100.64.0.1", users: new Set(["you@github"]) });
    cli.close();
  });
});
