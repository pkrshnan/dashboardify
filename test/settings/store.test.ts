import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import "../../src/settings/core";
import { SecretBox } from "../../src/settings/secret-box";
import { KeyMismatch, Registry, registry, SettingsStore } from "../../src/settings/store";

let dir: string;
const key = randomBytes(32);
const box = () => new SecretBox(key);

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "store-"));
});

afterEach(() => rm(dir, { recursive: true, force: true }));

function tables(store: SettingsStore): string[] {
  return store.db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name",
    )
    .all()
    .map((row) => row.name);
}

describe("SettingsStore.open", () => {
  test("creates settings.db with the core tables, readable only by the owner", async () => {
    const store = await SettingsStore.open(dir, box());

    // Other modules' tables are here too when their migrations are registered.
    expect(tables(store)).toEqual(
      expect.arrayContaining(["meta", "schema_migrations", "settings"]),
    );
    expect(store.db.query("SELECT tasks_inbox FROM settings").get()).toEqual({
      tasks_inbox: "Inbox.md",
    });
    expect((await stat(join(dir, "settings.db"))).mode & 0o777).toBe(0o600);
    store.close();
  });

  test("opens again with the same key", async () => {
    (await SettingsStore.open(dir, box())).close();

    const again = await SettingsStore.open(dir, box());

    expect(again.db.query("SELECT count(*) AS n FROM settings").get()).toEqual({ n: 1 });
    again.close();
  });

  test("a different key is caught at open", async () => {
    (await SettingsStore.open(dir, box())).close();

    await expect(SettingsStore.open(dir, new SecretBox(randomBytes(32)))).rejects.toBeInstanceOf(
      KeyMismatch,
    );
  });
});

describe("migrations", () => {
  test("run once each, core first, then in registration order", async () => {
    const order: string[] = [];
    const mine = new Registry();
    mine.register("calendar", [{ version: 1, up: () => order.push("calendar 1") }]);
    mine.register("core", [{ version: 1, up: () => order.push("core 1") }]);
    mine.register("mail", [
      { version: 1, up: () => order.push("mail 1") },
      { version: 2, up: () => order.push("mail 2") },
    ]);

    (await SettingsStore.open(dir, box(), mine)).close();
    (await SettingsStore.open(dir, box(), mine)).close();

    expect(order).toEqual(["core 1", "calendar 1", "mail 1", "mail 2"]);
  });

  test("a failing migration rolls back and runs again on the next open", async () => {
    let fail = true;
    const mine = new Registry();
    mine.register("calendar", [
      { version: 1, up: (db) => db.run("CREATE TABLE a (x)") },
      {
        version: 2,
        up: (db) => {
          db.run("CREATE TABLE b (x)");
          if (fail) {
            throw new Error("boom");
          }
        },
      },
    ]);

    await expect(SettingsStore.open(dir, box(), mine)).rejects.toThrow("boom");
    fail = false;
    const store = await SettingsStore.open(dir, box(), mine);

    expect(tables(store)).toContain("b");
    expect(
      store.db.query("SELECT version FROM schema_migrations WHERE module = 'calendar'").all(),
    ).toEqual([{ version: 1 }, { version: 2 }]);
    store.close();
  });

  test("must be numbered from 1 with no gaps", () => {
    expect(() =>
      new Registry().register("x", [{ version: 2, up: (db) => db.run("SELECT 1") }]),
    ).toThrow();
  });

  test("core is in the default registry once core.ts is imported", () => {
    expect(registry.modules.has("core")).toBe(true);
  });
});

describe("version", () => {
  test("changes when another connection writes", async () => {
    const server = await SettingsStore.open(dir, box());
    const cli = await SettingsStore.open(dir, box());
    const before = server.version();

    cli.db.run("UPDATE settings SET tasks_inbox = 'Tasks.md'");

    expect(server.version()).not.toBe(before);
    server.close();
    cli.close();
  });
});
