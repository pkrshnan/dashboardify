import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarAccounts } from "../../src/calendar/accounts";
import { DeviceStore } from "../../src/settings/devices";
import { loadKey } from "../../src/settings/key";
import { SecretBox } from "../../src/settings/secret-box";
import { KeyMismatch, SettingsStore } from "../../src/settings/store";

const CLI = join(import.meta.dir, "../../scripts/settings.ts");
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cli-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

async function settings(...args: string[]) {
  const proc = Bun.spawn(["bun", CLI, ...args], {
    env: { ...process.env, DATA_PATH: dir, SECRET_KEY_FILE: "" },
    stdout: "pipe",
    stderr: "pipe",
  });
  const [stdout, stderr, code] = await Promise.all([
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
    proc.exited,
  ]);
  return { stdout, stderr, code };
}

/** The store as the server would open it, with the key now on disk. */
async function open(): Promise<SettingsStore> {
  return SettingsStore.open(dir, new SecretBox(await loadKey({ dataPath: dir })));
}

async function withCalendarPassword(password: string): Promise<void> {
  const store = await open();
  new CalendarAccounts(store).create(
    {
      id: "icloud",
      provider: "icloud",
      displayName: "iCloud",
      serverUrl: "https://caldav.icloud.com/",
      homeUrl: "https://p42-caldav.icloud.com/1/calendars/",
      username: "you@icloud.com",
      password,
    },
    [
      {
        href: "https://p42-caldav.icloud.com/1/calendars/home/",
        displayName: "Personal",
        writable: true,
      },
    ],
  );
  store.close();
}

describe("bun run settings devices", () => {
  test("add prints a token that signs in; list shows it; revoke removes it", async () => {
    const added = await settings("devices", "add", "Pranav's", "iPhone");
    const token = added.stdout.trim().split("\n").at(-1) ?? "";
    const listed = await settings("devices", "list");
    const store = await open();
    const signsIn = new DeviceStore(store).match(token);
    store.close();
    const revoked = await settings("devices", "revoke", "pranavs-iphone");
    const after = await settings("devices", "list");

    expect(added.code).toBe(0);
    expect(token).toMatch(/^dfy_/);
    expect(signsIn).toBe("pranavs-iphone");
    expect(listed.stdout).toContain("pranavs-iphone\tPranav's iPhone");
    expect(revoked.stdout).toBe("Revoked pranavs-iphone.\n");
    expect(after.stdout).toBe("");
  });

  test("revoking an unknown device fails and says how to list them", async () => {
    const { code, stderr } = await settings("devices", "revoke", "nope");

    expect(code).toBe(1);
    expect(stderr).toContain("devices list");
  });
});

describe("bun run settings export", () => {
  test("writes TOML with no secrets", async () => {
    const { stdout: added } = await settings("devices", "add", "Mac");
    const token = added.trim().split("\n").at(-1) ?? "";
    await withCalendarPassword("abcd-efgh-ijkl-mnop");

    const { stdout, code } = await settings("export");

    expect(code).toBe(0);
    expect(stdout).toContain("[[devices]]");
    expect(stdout).toContain('display_name = "Mac"');
    expect(stdout).toContain("[[calendar_accounts]]");
    expect(stdout).toContain('password_sealed = "<set>"');
    expect(stdout).not.toContain("abcd-efgh-ijkl-mnop");
    expect(stdout).not.toContain(token);
    expect(stdout).not.toContain("token_hash");
  });
});

describe("bun run settings key and rotate-key", () => {
  test("key show prints the key as base64", async () => {
    const { stdout } = await settings("key", "show");

    expect(Buffer.from(stdout.trim(), "base64")).toEqual(
      Buffer.from(await loadKey({ dataPath: dir })),
    );
  });

  test("rotate-key re-seals secrets: the new key opens them and the old one doesn't", async () => {
    await withCalendarPassword("abcd-efgh-ijkl-mnop");
    const oldKey = await loadKey({ dataPath: dir });

    const { stdout, code } = await settings("rotate-key");
    const store = await open();
    const password = new CalendarAccounts(store).password("icloud");
    store.close();

    expect(code).toBe(0);
    expect(stdout).toContain("Re-sealed 1 secret");
    expect(password).toBe("abcd-efgh-ijkl-mnop");
    expect(await loadKey({ dataPath: dir })).not.toEqual(oldKey);
    await expect(SettingsStore.open(dir, new SecretBox(oldKey))).rejects.toBeInstanceOf(
      KeyMismatch,
    );
    expect(await Bun.file(join(dir, "secret.key.new")).exists()).toBe(false);
  });

  test("rotate-key refuses while the server holds its lock", async () => {
    await settings("key", "show");
    await writeFile(join(dir, "server.lock"), String(process.pid));
    const before = await loadKey({ dataPath: dir });

    const { code, stderr } = await settings("rotate-key");

    expect(code).toBe(1);
    expect(stderr).toContain("The server is running");
    expect(await loadKey({ dataPath: dir })).toEqual(before);
  });

  test("a lock left by a server that has stopped doesn't block it", async () => {
    await settings("key", "show");
    await writeFile(join(dir, "server.lock"), "999999");

    expect((await settings("rotate-key")).code).toBe(0);
  });
});
