// Merging raw sample uploads: one stream, one UTC day, rows keyed by `ts` (epoch ms). Pure
// functions only; raw-store.ts reads and writes the Parquet files.

import { fail, ok, type Parsed } from "../parsed";

export type Cell = number | string | null;
export type ColumnType = "number" | "text";

export interface Column {
  name: string;
  /** null until a non-empty value has been seen, e.g. battery before the strap reports it. */
  type: ColumnType | null;
}

export interface Sample {
  ts: number;
  values: Cell[];
}

export interface Upload {
  header: string[];
  samples: Sample[];
}

/**
 * The stream's columns after this upload. The first upload fixes the names; a later upload must
 * send the same header. A column's type is fixed by the first value seen in it.
 */
export function mergeColumns(known: Column[] | null, upload: Upload): Parsed<Column[]> {
  const names = upload.header.slice(1);
  const columns = known ?? names.map((name) => ({ name, type: null }));
  if (columns.map((c) => c.name).join(",") !== names.join(",")) {
    return fail(`header must be ts,${columns.map((c) => c.name).join(",")}`);
  }
  const merged = columns.map((column) => ({ ...column }));
  for (const sample of upload.samples) {
    const error = typeColumns(merged, sample);
    if (error) {
      return fail(error);
    }
  }
  return ok(merged);
}

/** Set each column's type from this sample's values. Returns an error on a mismatch. */
function typeColumns(columns: Column[], sample: Sample): string | null {
  for (const [i, value] of sample.values.entries()) {
    const column = columns[i];
    if (!column || value === null) {
      continue;
    }
    const type = typeOf(value);
    if (column.type && column.type !== type) {
      return `column ${column.name} holds ${column.type}, got ${type} at ts ${sample.ts}`;
    }
    column.type = type;
  }
  return null;
}

function typeOf(value: number | string): ColumnType {
  return typeof value === "number" ? "number" : "text";
}

export interface MergeResult {
  samples: Sample[];
  added: number;
  replaced: number;
}

/** Merge an upload into a day's samples by ts. On a repeated ts the newer upload wins. */
export function mergeSamples(existing: Sample[], incoming: Sample[]): MergeResult {
  const byTs = new Map(existing.map((s) => [s.ts, s]));
  let added = 0;
  let replaced = 0;
  for (const sample of incoming) {
    if (byTs.has(sample.ts)) {
      replaced++;
    } else {
      added++;
    }
    byTs.set(sample.ts, sample);
  }
  const samples = [...byTs.values()].sort((a, b) => a.ts - b.ts);
  return { samples, added, replaced };
}
