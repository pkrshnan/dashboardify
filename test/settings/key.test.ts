import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { KeyError, loadKey } from "../../src/settings/key";

let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "key-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

describe("loadKey", () => {
  test("makes 32 random bytes on first run, readable only by the owner", async () => {
    const dataPath = join(dir, "data");

    const key = await loadKey({ dataPath });

    expect(key.length).toBe(32);
    expect((await stat(join(dataPath, "secret.key"))).mode & 0o777).toBe(0o600);
    expect((await stat(dataPath)).mode & 0o777).toBe(0o700);
  });

  test("reuses the key on later runs", async () => {
    const first = await loadKey({ dataPath: dir });

    expect(await loadKey({ dataPath: dir })).toEqual(first);
  });

  test("reads a key written as base64, as a password manager would hold it", async () => {
    const raw = await loadKey({ dataPath: join(dir, "a") });
    const keyFile = join(dir, "from-secret");
    await writeFile(keyFile, `${Buffer.from(raw).toString("base64")}\n`);

    expect(await loadKey({ dataPath: dir, keyFile })).toEqual(raw);
  });

  test("rejects a key of the wrong length", async () => {
    const keyFile = join(dir, "short");
    await writeFile(keyFile, new Uint8Array(16));

    await expect(loadKey({ dataPath: dir, keyFile })).rejects.toBeInstanceOf(KeyError);
  });

  test("a missing SECRET_KEY_FILE is an error, not a new key", async () => {
    const keyFile = join(dir, "missing");

    await expect(loadKey({ dataPath: dir, keyFile })).rejects.toBeInstanceOf(KeyError);
    expect(await Bun.file(join(dir, "secret.key")).exists()).toBe(false);
  });

  test("refuses to make a new key for an existing settings.db", async () => {
    await writeFile(join(dir, "settings.db"), "");

    await expect(loadKey({ dataPath: dir })).rejects.toThrow("Restore the key");
    expect(await Bun.file(join(dir, "secret.key")).exists()).toBe(false);
  });
});
