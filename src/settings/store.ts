// settings.db: settings, devices and each feature's own tables, in SQLite outside the vault.
// Feature modules register numbered migrations under their own name, so none of them edits a
// central list. Secrets are sealed with the SecretBox before they are written.

import { Database } from "bun:sqlite";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { OpenError, type SecretBox } from "./secret-box";

export interface Migration {
  version: number;
  up: (db: Database) => void;
}

/** Columns holding sealed values; rotate-key re-seals them with AAD "<table>/<id>/<field>". */
export interface SealedColumns {
  table: string;
  idColumn: string;
  columns: string[];
}

/** Migrations and sealed columns, by module. Modules add to the default one when imported. */
export class Registry {
  readonly modules = new Map<string, Migration[]>();
  readonly sealed: SealedColumns[] = [];

  register(module: string, migrations: Migration[]): void {
    const versions = migrations.map((m) => m.version);
    if (versions.some((v, i) => v !== i + 1)) {
      throw new Error(`${module} migrations must be numbered 1, 2, 3…`);
    }
    this.modules.set(module, migrations);
  }

  registerSealed(table: string, idColumn: string, columns: string[]): void {
    this.sealed.push({ table, idColumn, columns });
  }
}

export const registry = new Registry();

export class KeyMismatch extends Error {
  constructor() {
    super("secret.key doesn't match settings.db");
  }
}

const KEY_CHECK = "settings.db key check";
const KEY_CHECK_AAD = "meta/key_check/value";

export class SettingsStore {
  private constructor(
    readonly db: Database,
    readonly box: SecretBox,
  ) {}

  static register(module: string, migrations: Migration[]): void {
    registry.register(module, migrations);
  }

  static registerSealed(table: string, idColumn: string, columns: string[]): void {
    registry.registerSealed(table, idColumn, columns);
  }

  /**
   * Opens $DATA_PATH/settings.db (mode 0600), runs every migration not yet applied with `core`
   * first, and checks the key against the one the database was made with.
   */
  static async open(dataPath: string, box: SecretBox, from = registry): Promise<SettingsStore> {
    await mkdir(dataPath, { recursive: true, mode: 0o700 });
    const path = join(dataPath, "settings.db");
    const db = new Database(path, { create: true, strict: true });
    await chmod(path, 0o600);
    db.run("PRAGMA journal_mode = WAL");
    db.run("PRAGMA foreign_keys = ON");
    db.run("PRAGMA busy_timeout = 5000");
    const store = new SettingsStore(db, box);
    try {
      store.migrate(from);
      store.checkKey();
    } catch (error) {
      db.close();
      throw error;
    }
    return store;
  }

  transaction<T>(fn: (db: Database) => T): T {
    return this.db.transaction(() => fn(this.db))();
  }

  /** Changes whenever another connection (the CLI) writes; caches compare it. */
  version(): number {
    const row = this.db.query<{ data_version: number }, []>("PRAGMA data_version").get();
    return row?.data_version ?? 0;
  }

  close(): void {
    this.db.close();
  }

  private migrate(from: Registry): void {
    this.db.run(
      "CREATE TABLE IF NOT EXISTS schema_migrations (module TEXT NOT NULL, version INTEGER NOT NULL, apply_time TEXT NOT NULL, PRIMARY KEY (module, version))",
    );
    const applied = this.db.query<{ version: number }, [string]>(
      "SELECT version FROM schema_migrations WHERE module = ?",
    );
    const record = this.db.query<unknown, [string, number, string]>(
      "INSERT INTO schema_migrations (module, version, apply_time) VALUES (?, ?, ?)",
    );
    const order = [...from.modules.keys()].sort(
      (a, b) => Number(b === "core") - Number(a === "core"),
    );
    for (const module of order) {
      const done = new Set(applied.all(module).map((row) => row.version));
      for (const migration of from.modules.get(module) ?? []) {
        if (!done.has(migration.version)) {
          // The migration and its record commit together, so a failure leaves neither.
          this.transaction((db) => {
            migration.up(db);
            record.run(module, migration.version, new Date().toISOString());
          });
        }
      }
    }
  }

  /** The first open seals a known value; later opens must be able to open it. */
  private checkKey(): void {
    this.db.run("CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value BLOB NOT NULL)");
    const row = this.db
      .query<{ value: Uint8Array }, []>("SELECT value FROM meta WHERE key = 'key_check'")
      .get();
    if (!row) {
      this.db
        .query("INSERT INTO meta (key, value) VALUES ('key_check', ?)")
        .run(this.box.seal(KEY_CHECK_AAD, KEY_CHECK));
      return;
    }
    try {
      if (this.box.open(KEY_CHECK_AAD, row.value) !== KEY_CHECK) {
        throw new KeyMismatch();
      }
    } catch (error) {
      throw error instanceof OpenError ? new KeyMismatch() : error;
    }
  }
}
