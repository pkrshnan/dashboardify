import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/settings/core";
import { DeviceStore } from "../../src/settings/devices";
import { importEnvTokens, parseTokens } from "../../src/settings/env-import";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";

const TOKENS = "iphone:abcdefghijklmnop, mac:qrstuvwxyz012345";
let dir: string;
let store: SettingsStore;
const quiet: string[] = [];
const ignore = (line: string) => quiet.push(line);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "import-"));
  store = await SettingsStore.open(dir, new SecretBox(randomBytes(32)));
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

describe("importEnvTokens", () => {
  test("old tokens keep signing in after the import", () => {
    const devices = new DeviceStore(store);
    const log: string[] = [];

    importEnvTokens(store, devices, TOKENS, (line) => log.push(line));

    expect(devices.match("abcdefghijklmnop")).toBe("iphone");
    expect(devices.match("qrstuvwxyz012345")).toBe("mac");
    expect(log).toEqual([
      "Imported the iphone device token from INGEST_TOKENS.",
      "Imported the mac device token from INGEST_TOKENS.",
    ]);
  });

  test("runs once: later starts don't re-add a revoked device, and say to remove the variable", () => {
    const devices = new DeviceStore(store);
    importEnvTokens(store, devices, TOKENS, ignore);
    devices.revoke("iphone");
    const log: string[] = [];

    importEnvTokens(store, devices, TOKENS, (line) => log.push(line));

    expect(devices.match("abcdefghijklmnop")).toBeUndefined();
    expect(log).toEqual([
      "INGEST_TOKENS was imported into Settings and is no longer read. Remove it from .env.",
    ]);
  });

  test("with nothing to import, still records that it ran", () => {
    const devices = new DeviceStore(store);
    importEnvTokens(store, devices, undefined, ignore);

    importEnvTokens(store, devices, TOKENS, ignore);

    expect(devices.list()).toEqual([]);
  });
});

describe("parseTokens", () => {
  test("reads name:token pairs", () => {
    expect(parseTokens(TOKENS)).toEqual([
      ["iphone", "abcdefghijklmnop"],
      ["mac", "qrstuvwxyz012345"],
    ]);
    expect(parseTokens("")).toEqual([]);
  });

  test("rejects short or malformed tokens without printing them", () => {
    expect(() => parseTokens("iphone:short")).toThrow("at least 16");
    expect(() => parseTokens("nocolon")).toThrow("bad INGEST_TOKENS");
    expect(() => parseTokens(":abcdefghijklmnop")).toThrow("bad INGEST_TOKENS");
    expect(() => parseTokens("iphone:abcdefghijklmnop:x")).not.toThrow();
  });
});
