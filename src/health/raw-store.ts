// Raw sample storage: health-raw/<stream>/YYYY/MM/YYYY-MM-DD.parquet, one file per stream per
// UTC day, plus health-raw/<stream>/columns.json. Kept outside the vault: it is too big for
// Markdown tools and git, and it is backed up separately.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Mutex } from "async-mutex";
import { parquetReadObjects } from "hyparquet";
import { parquetWriteBuffer } from "hyparquet-writer";
import { ok, type Parsed } from "../server/validate";
import {
  type Cell,
  type Column,
  mergeColumns,
  mergeSamples,
  type Sample,
  type Upload,
} from "./samples";

export interface StoreResult {
  rows: number;
  added: number;
  replaced: number;
}

export class RawStore {
  // One lock per stream: columns.json and the day file change together.
  private readonly locks = new Map<string, Mutex>();

  constructor(readonly root: string) {}

  dayPath(stream: string, day: string): string {
    return join(stream, day.slice(0, 4), day.slice(5, 7), `${day}.parquet`);
  }

  /** Merge an upload into the stream's file for `day`. */
  store(stream: string, day: string, upload: Upload): Promise<Parsed<StoreResult>> {
    return this.lockFor(stream).runExclusive(async () => {
      const columns = mergeColumns(await this.readColumns(stream), upload);
      if (!columns.ok) {
        return columns;
      }
      const path = this.dayPath(stream, day);
      const merged = mergeSamples(await this.readDay(path, columns.value), upload.samples);
      await this.write(path, toParquet(columns.value, merged.samples));
      await this.write(join(stream, "columns.json"), `${JSON.stringify(columns.value, null, 2)}\n`);
      return ok({ rows: merged.samples.length, added: merged.added, replaced: merged.replaced });
    });
  }

  /** The samples stored for a stream and day, oldest first. */
  async readDay(path: string, columns: Column[]): Promise<Sample[]> {
    const bytes = await this.read(path);
    if (!bytes) {
      return [];
    }
    const rows = await parquetReadObjects({ file: bytes.buffer as ArrayBuffer });
    return rows.map((row) => ({
      ts: Number(row.ts),
      values: columns.map((c) => (row[c.name] ?? null) as Cell),
    }));
  }

  /**
   * Rows of a stream with from <= ts < to, as objects keyed by column name, oldest first.
   * Reads every UTC day file the range touches; a missing stream or day is just no rows.
   */
  async readRange(stream: string, from: number, to: number): Promise<Row[]> {
    const columns = await this.readColumns(stream);
    if (!columns) {
      return [];
    }
    const rows: Row[] = [];
    for (const day of utcDays(from, to)) {
      for (const sample of await this.readDay(this.dayPath(stream, day), columns)) {
        if (sample.ts >= from && sample.ts < to) {
          rows.push(toRow(columns, sample));
        }
      }
    }
    return rows;
  }

  async readColumns(stream: string): Promise<Column[] | null> {
    const bytes = await this.read(join(stream, "columns.json"));
    return bytes ? (JSON.parse(new TextDecoder().decode(bytes)) as Column[]) : null;
  }

  private async read(rel: string): Promise<Uint8Array | null> {
    try {
      return new Uint8Array(await readFile(join(this.root, rel)));
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /** Temp file + rename, so a backup never copies half a file. */
  private async write(rel: string, data: string | ArrayBuffer): Promise<void> {
    const abs = join(this.root, rel);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, typeof data === "string" ? data : new Uint8Array(data));
    await rename(tmp, abs);
  }

  private lockFor(stream: string): Mutex {
    let lock = this.locks.get(stream);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(stream, lock);
    }
    return lock;
  }
}

/** A stored sample as `{ ts, column: value, … }`. */
export type Row = { ts: number } & Record<string, Cell>;

function toRow(columns: Column[], sample: Sample): Row {
  const row: Row = { ts: sample.ts };
  for (const [i, column] of columns.entries()) {
    row[column.name] = sample.values[i] ?? null;
  }
  return row;
}

const DAY_MS = 86_400_000;

/** The UTC dates (YYYY-MM-DD) that [from, to) touches. */
export function utcDays(from: number, to: number): string[] {
  const days: string[] = [];
  for (let t = Math.floor(from / DAY_MS) * DAY_MS; t < to; t += DAY_MS) {
    days.push(new Date(t).toISOString().slice(0, 10));
  }
  return days;
}

/** ts is INT64 epoch ms; number columns are DOUBLE, text columns STRING. */
function toParquet(columns: Column[], samples: Sample[]): ArrayBuffer {
  return parquetWriteBuffer({
    columnData: [
      { name: "ts", data: samples.map((s) => BigInt(s.ts)), type: "INT64", nullable: false },
      ...columns.map((column, i) => ({
        name: column.name,
        data: samples.map((s) => s.values[i] ?? null),
        type: column.type === "text" ? ("STRING" as const) : ("DOUBLE" as const),
      })),
    ],
  });
}
