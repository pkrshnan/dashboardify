// Parsing and merging raw sample uploads: one stream, one UTC day, CSV with `ts` (epoch ms)
// first. Pure functions only; raw-store.ts reads and writes the Parquet files.

import Papa from "papaparse";
import { fail, ok, type Parsed } from "../server/validate";

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

const DAY_MS = 86_400_000;
const COLUMN_NAME = /^[a-z][a-z0-9_]{0,39}$/;

/** Parse an upload for `day` (YYYY-MM-DD, UTC). Errors name the CSV line they refer to. */
export function parseUpload(csv: string, day: string): Parsed<Upload> {
  const { data } = Papa.parse<string[]>(csv.trim(), { skipEmptyLines: true });
  const [header, ...rows] = data;
  const checked = checkHeader(header);
  if (!checked.ok) {
    return checked;
  }
  const start = Date.parse(`${day}T00:00:00Z`);
  const samples: Sample[] = [];
  for (const [index, row] of rows.entries()) {
    const sample = parseRow(row, checked.value.length, start);
    if (!sample.ok) {
      return fail(`line ${index + 2}: ${sample.error}`);
    }
    samples.push(sample.value);
  }
  return ok({ header: checked.value, samples });
}

function checkHeader(header: string[] | undefined): Parsed<string[]> {
  if (header?.[0] !== "ts") {
    return fail("line 1: the first column must be ts");
  }
  const bad = header.find((name) => !COLUMN_NAME.test(name));
  if (bad !== undefined) {
    return fail(`line 1: bad column name "${bad}"`);
  }
  if (new Set(header).size !== header.length) {
    return fail("line 1: duplicate column name");
  }
  return ok(header);
}

function parseRow(row: string[], width: number, dayStart: number): Parsed<Sample> {
  if (row.length !== width) {
    return fail(`expected ${width} cells, got ${row.length}`);
  }
  const ts = Number(row[0]);
  if (!Number.isSafeInteger(ts)) {
    return fail("ts must be epoch milliseconds");
  }
  if (ts < dayStart || ts >= dayStart + DAY_MS) {
    return fail("ts is outside the day");
  }
  return ok({ ts, values: row.slice(1).map(parseCell) });
}

function parseCell(cell: string): Cell {
  if (cell === "") {
    return null;
  }
  const number = Number(cell);
  return Number.isFinite(number) && cell.trim() !== "" ? number : cell;
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
