// A readable copy of settings.db as TOML, for diffs and backups. Secrets never leave: sealed
// columns are written as "<set>", and other binary columns (token hashes) are left out.

import { type Registry, registry, type SettingsStore } from "./store";

/** Bookkeeping tables nobody needs to read. */
const SKIP = new Set(["schema_migrations", "meta"]);

export function exportToml(store: SettingsStore, from: Registry = registry): string {
  const tables = store.db
    .query<{ name: string }, []>(
      "SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY rowid",
    )
    .all()
    .map((row) => row.name)
    .filter((name) => !SKIP.has(name));
  const sealed = new Set(from.sealed.flatMap((s) => s.columns.map((c) => `${s.table}.${c}`)));
  const lines = ["# dashboardify settings, exported without secrets.", ""];
  for (const table of tables) {
    for (const row of store.db.query<Record<string, unknown>, []>(`SELECT * FROM ${table}`).all()) {
      lines.push(`[[${table}]]`);
      for (const [column, value] of Object.entries(row)) {
        const line = tomlValue(value, sealed.has(`${table}.${column}`));
        if (line !== undefined) {
          lines.push(`${column} = ${line}`);
        }
      }
      lines.push("");
    }
  }
  return lines.join("\n");
}

function tomlValue(value: unknown, isSealed: boolean): string | undefined {
  if (value === null || value === undefined) {
    return undefined;
  }
  if (value instanceof Uint8Array) {
    return isSealed ? '"<set>"' : undefined;
  }
  if (typeof value === "number" || typeof value === "bigint") {
    return String(value);
  }
  // JSON string escapes are valid TOML basic-string escapes.
  return JSON.stringify(String(value));
}
