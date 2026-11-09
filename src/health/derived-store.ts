// Computed health tables: health-derived/<table>/YYYY/MM/YYYY-MM-DD.parquet, one file per local
// date: one row for nights and days, one row per workout, walk or lifting set for workouts, walks and sets. Everything here can be rebuilt from health-raw/, so it is overwritten whole and not
// backed up. Every row carries the algorithm version that produced it.

import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";

export type DerivedRow = Record<string, number | string | null>;
/** Tables with one row per date. */
export type DailyTable = "nights" | "days";
export type Table = DailyTable | "workouts" | "walks" | "sets";

export class DerivedStore {
  constructor(readonly root: string) {}

  path(table: Table, date: string): string {
    return join(this.root, table, date.slice(0, 4), date.slice(5, 7), `${date}.parquet`);
  }

  async write(table: Table, date: string, row: DerivedRow): Promise<void> {
    await this.writeAll(table, date, [row]);
  }

  /** Replace the date's rows. With none, the file is removed, so stale rows don't linger. */
  async writeAll(table: Table, date: string, rows: DerivedRow[]): Promise<void> {
    const abs = this.path(table, date);
    const [first] = rows;
    if (!first) {
      await rm(abs, { force: true });
      return;
    }
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, new Uint8Array(toParquet(Object.keys(first), rows)));
    await rename(tmp, abs);
  }

  async read(table: Table, date: string): Promise<DerivedRow | null> {
    const [row] = await this.readAll(table, date);
    return row ?? null;
  }

  async readAll(table: Table, date: string): Promise<DerivedRow[]> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(this.path(table, date)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return [];
      }
      throw err;
    }
    return (await parquetReadObjects({ file: bytes.buffer as ArrayBuffer })) as DerivedRow[];
  }
}

/** Strings are STRING columns; numbers and nulls are DOUBLE. Every row has the same keys. */
function toParquet(names: string[], rows: DerivedRow[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: names.map((name) => ({
      name,
      data: rows.map((row) => row[name] ?? null),
      type: rows.some((row) => typeof row[name] === "string")
        ? ("STRING" as const)
        : ("DOUBLE" as const),
    })),
  });
}
