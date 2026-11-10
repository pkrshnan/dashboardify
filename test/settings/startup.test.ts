import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadStartup } from "../../src/server/config";
import { GeneralSettings } from "../../src/settings/core";
import { configFromSettings, type Opened, openSettings } from "../../src/settings/startup";
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

  test("the time zone and inbox come from Settings", async () => {
    const first = await start();
    first.general.update({ timeZone: "Europe/London", tasksInbox: "Tasks.md" });

    const { config } = await start();

    expect(config).toMatchObject({ timeZone: "Europe/London", tasksInbox: "Tasks.md" });
  });

  test("a retired variable in the environment is ignored, with a warning", async () => {
    const first = await start();
    first.general.update({ timeZone: "Europe/London" });
    log = [];

    const { config, devices } = await start({
      TZ_NAME: "Asia/Tokyo",
      INGEST_TOKENS: "mac:abcdefghijklmnopqrstuvwxyz",
    });

    expect(config.timeZone).toBe("Europe/London");
    expect(devices.list()).toEqual([]);
    expect(log.filter((line) => line.includes("no longer read"))).toHaveLength(2);
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

  test("an interrupted rotate-key says to move secret.key.new into place", async () => {
    await start();
    const keyPath = join(dir, "data", "secret.key");
    await Bun.write(`${keyPath}.new`, await Bun.file(keyPath).arrayBuffer());
    await Bun.write(keyPath, new Uint8Array(32).fill(7));

    await expect(start()).rejects.toThrow("a rotate-key was interrupted");
  });

  test("a fresh install prints a setup code; one with a device or tailnet sign-in doesn't", async () => {
    const fresh = await start();
    const printed = log.find((line) => line.includes("setup code"));
    fresh.devices.add("Mac");
    log = [];
    const later = await start();
    fresh.devices.revoke(fresh.devices.list()[0]?.id ?? "");
    fresh.general.update({ tailnetProxy: "100.64.0.1", tailnetLogins: ["you@github"] });
    const tailnet = await start();

    expect(printed).toMatch(
      /^No devices yet\. Open http:\/\/localhost:8787 and enter setup code [2-9A-Z]{4}-[2-9A-Z]{4} \(valid 15 minutes\)\.$/,
    );
    expect(fresh.setupCode.active()).toBe(true);
    expect(log.some((line) => line.includes("setup code"))).toBe(false);
    expect(later.setupCode.active()).toBe(false);
    expect(tailnet.setupCode.active()).toBe(false);
  });
});

describe("configFromSettings", () => {
  const startup = () =>
    loadStartup({ VAULT_PATH: join(dir, "vault"), DATA_PATH: join(dir, "data") });

  test("reads the time zone the server uses from Settings", async () => {
    const server = await start();
    server.general.update({ timeZone: "Asia/Tokyo" });

    expect((await configFromSettings(startup())).timeZone).toBe("Asia/Tokyo");
  });

  test("uses the defaults before the first start, without creating anything", async () => {
    const config = await configFromSettings(startup());

    expect(config.tasksInbox).toBe("Inbox.md");
    expect(await Bun.file(join(dir, "data", "secret.key")).exists()).toBe(false);
  });
});
