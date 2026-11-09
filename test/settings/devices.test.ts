import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/settings/core";
import { DeviceStore, newToken, slug } from "../../src/settings/devices";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";

let dir: string;
let store: SettingsStore;
const key = randomBytes(32);
const open = () => SettingsStore.open(dir, new SecretBox(key));

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "devices-"));
  store = await open();
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("DeviceStore", () => {
  test("a new device gets a dfy_ token that signs in as that device", () => {
    const devices = new DeviceStore(store);

    const { device, token } = devices.add("Pranav's iPhone");

    expect(device.id).toBe("pranavs-iphone");
    expect(token).toMatch(/^dfy_[A-Za-z0-9_-]{43}$/);
    expect(devices.match(token)).toBe("pranavs-iphone");
  });

  test("only the hash is stored, never the token", async () => {
    const { token } = new DeviceStore(store).add("Mac");
    store.close();

    for (const name of await readdir(dir)) {
      const bytes = await readFile(join(dir, name));
      expect(bytes.includes(Buffer.from(token))).toBe(false);
      expect(bytes.includes(Buffer.from(token.slice(4)))).toBe(false);
    }
    store = await open();
  });

  test("an unknown or empty token matches nothing", () => {
    const devices = new DeviceStore(store);
    devices.add("Mac");

    expect(devices.match(newToken())).toBeUndefined();
    expect(devices.match("")).toBeUndefined();
  });

  test("a revoked device stops signing in", () => {
    const devices = new DeviceStore(store);
    const { device, token } = devices.add("Old phone");

    expect(devices.revoke(device.id)).toBe(true);

    expect(devices.match(token)).toBeUndefined();
    expect(devices.revoke(device.id)).toBe(false);
  });

  test("a revoke from another connection, like the CLI, applies on the next match", async () => {
    const server = new DeviceStore(store);
    const { device, token } = server.add("Old phone");
    expect(server.match(token)).toBe(device.id);
    const cli = await open();

    new DeviceStore(cli).revoke(device.id);

    expect(server.match(token)).toBeUndefined();
    cli.close();
  });

  test("names become unique ids", () => {
    const devices = new DeviceStore(store);

    const ids = ["iPhone", "iPhone", "iPhone"].map((name) => devices.add(name).device.id);

    expect(ids).toEqual(["iphone", "iphone-2", "iphone-3"]);
    expect(slug("Café · Desk")).toBe("cafe-desk");
    expect(slug("☕")).toBe("device");
  });

  test("last use is written at most once a minute", () => {
    let now = new Date("2026-11-08T09:00:00Z");
    const devices = new DeviceStore(store, () => now);
    const { token } = devices.add("Mac");
    const lastUsed = () => devices.list()[0]?.lastUsedTime;

    devices.match(token);
    const first = lastUsed();
    now = new Date("2026-11-08T09:00:30Z");
    devices.match(token);
    const halfMinute = lastUsed();
    now = new Date("2026-11-08T09:01:01Z");
    devices.match(token);

    expect(first).toBe("2026-11-08T09:00:00.000Z");
    expect(halfMinute).toBe(first);
    expect(lastUsed()).toBe("2026-11-08T09:01:01.000Z");
  });
});
