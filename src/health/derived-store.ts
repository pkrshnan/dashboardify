// Computed health tables: health-derived/<table>/YYYY/MM/YYYY-MM-DD.parquet, one row per local
// date. Everything here can be rebuilt from health-raw/, so it is overwritten whole and not
// backed up. Every row carries the algorithm version that produced it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";

export type DerivedRow = Record<string, number | string | null>;
export type Table = "nights" | "days";

export class DerivedStore {
  constructor(readonly root: string) {}

  path(table: Table, date: string): string {
    return join(this.root, table, date.slice(0, 4), date.slice(5, 7), `${date}.parquet`);
  }

  async write(table: Table, date: string, row: DerivedRow): Promise<void> {
    const abs = this.path(table, date);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, new Uint8Array(toParquet(row)));
    await rename(tmp, abs);
  }

  async read(table: Table, date: string): Promise<DerivedRow | null> {
    let bytes: Uint8Array;
    try {
      bytes = new Uint8Array(await readFile(this.path(table, date)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
    const [row] = await parquetReadObjects({ file: bytes.buffer as ArrayBuffer });
    return (row as DerivedRow | undefined) ?? null;
  }
}

/** Strings are STRING columns; numbers and nulls are DOUBLE. */
function toParquet(row: DerivedRow): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: Object.entries(row).map(([name, value]) => ({
      name,
      data: [value],
      type: typeof value === "string" ? ("STRING" as const) : ("DOUBLE" as const),
    })),
  });
}
