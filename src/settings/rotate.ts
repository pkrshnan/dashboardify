// Replaces secret.key with a new one. Every registered sealed column and the key check are
// re-sealed in one transaction. The new key is written beside the old one first and renamed into
// place last, so a crash in between leaves the right key on disk as secret.key.new.

import type { Database } from "bun:sqlite";
import { randomBytes } from "node:crypto";
import { chmod, rename } from "node:fs/promises";
import { join } from "node:path";
import { KEY_BYTES } from "./key";
import { SecretBox } from "./secret-box";
import { type Registry, registry, type SealedColumns, type SettingsStore } from "./store";

const KEY_CHECK_AAD = "meta/key_check/value";

export interface Rotated {
  /** How many sealed values were re-sealed, not counting the key check. */
  values: number;
  key: Uint8Array;
}

export async function rotateKey(
  store: SettingsStore,
  keyPath: string,
  from: Registry = registry,
): Promise<Rotated> {
  const key = new Uint8Array(randomBytes(KEY_BYTES));
  const next = new SecretBox(key);
  const staged = `${keyPath}.new`;
  await Bun.write(staged, key);
  await chmod(staged, 0o600);
  const values = store.transaction((db) => {
    const count = from.sealed.reduce(
      (sum, columns) => sum + reseal(db, columns, store.box, next),
      0,
    );
    resealKeyCheck(db, store.box, next);
    return count;
  });
  await rename(staged, keyPath);
  return { values, key };
}

/** Re-seals one table's sealed columns; returns how many values there were. */
function reseal(
  db: Database,
  { table, idColumn, columns }: SealedColumns,
  old: SecretBox,
  next: SecretBox,
): number {
  let count = 0;
  for (const row of db.query<Record<string, unknown>, []>(`SELECT * FROM ${table}`).all()) {
    for (const column of columns.filter((c) => row[c] instanceof Uint8Array)) {
      const aad = `${table}/${row[idColumn]}/${column}`;
      const value = old.open(aad, row[column] as Uint8Array);
      db.query(`UPDATE ${table} SET ${column} = ? WHERE ${idColumn} = ?`).run(
        next.seal(aad, value),
        row[idColumn] as string,
      );
      count++;
    }
  }
  return count;
}

function resealKeyCheck(db: Database, old: SecretBox, next: SecretBox): void {
  const check = db
    .query<{ value: Uint8Array }, []>("SELECT value FROM meta WHERE key = 'key_check'")
    .get();
  if (check) {
    db.query("UPDATE meta SET value = ? WHERE key = 'key_check'").run(
      next.seal(KEY_CHECK_AAD, old.open(KEY_CHECK_AAD, check.value)),
    );
  }
}

/** The server holds this while running, so rotate-key can refuse. */
export function lockPath(dataPath: string): string {
  return join(dataPath, "server.lock");
}

/** The pid in server.lock, if that process is still running. */
export async function serverRunning(dataPath: string): Promise<number | undefined> {
  const file = Bun.file(lockPath(dataPath));
  if (!(await file.exists())) {
    return undefined;
  }
  const pid = Number((await file.text()).trim());
  if (!Number.isInteger(pid) || pid <= 0) {
    return undefined;
  }
  try {
    process.kill(pid, 0);
    return pid;
  } catch {
    return undefined;
  }
}
