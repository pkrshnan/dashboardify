import { readdir } from "node:fs/promises";
import type { RawStore } from "../../health/raw-store";
import type { Upload } from "../../health/samples";
import { fromDateParts } from "./date-time";
import { ApiError, invalidArgument } from "./errors";
import { paginate } from "./pagination";
import type { ApiRequests, ColumnInput, SampleUpload } from "./requests";
/** Validates columnar uploads before merging samples into Parquet. */
export class SamplesService {
  constructor(
    private readonly raw: RawStore,
    private readonly onSamples: (stream: string, day: string) => void,
  ) {}

  private readonly stream = async (name: string) => {
    if (!/^streams\/[a-z0-9_]{1,40}$/.test(name ?? "")) {
      invalidArgument("invalid stream name");
    }
    const columns = await this.raw.readColumns(name.slice(8));
    if (!columns) {
      throw new ApiError(404, "stream not found");
    }
    return {
      name,
      columns: columns.map((column) => ({
        name: column.name,
        type:
          ({ number: "TYPE_NUMBER", text: "TYPE_TEXT" } as Record<string, string>)[
            column.type ?? ""
          ] ?? "TYPE_UNSPECIFIED",
      })),
    };
  };

  getStream = async (request: ApiRequests["getStream"]) => this.stream(request.name);

  listStreams = async (request: ApiRequests["listStreams"]) => {
    let names: string[] = [];
    try {
      names = (await readdir(this.raw.root))
        .filter((streamName) => /^[a-z0-9_]{1,40}$/.test(streamName))
        .sort();
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") {
        throw error;
      }
    }
    const rows = [];
    for (const streamName of names) {
      if (await this.raw.readColumns(streamName)) {
        rows.push(await this.stream(`streams/${streamName}`));
      }
    }
    const resultPage = paginate(rows, request);
    return { streams: resultPage.items, nextPageToken: resultPage.nextPageToken };
  };

  mergeSamples = async (request: ApiRequests["mergeSamples"]) => {
    if (!/^streams\/[a-z0-9_]{1,40}$/.test(request.stream ?? "")) {
      invalidArgument("invalid stream");
    }
    const day = fromDateParts(request.day ?? {});
    const timestamps = uploadTimestamps(request, day);
    validateColumns(request.columns, timestamps.length);
    const upload: Upload = {
      header: ["ts", ...request.columns.map((column: ColumnInput) => column.name)],
      samples: timestamps.map((timestamp: number, rowIndex: number) => ({
        ts: timestamp,
        values: request.columns.map((column: ColumnInput) =>
          (column.missingRows ?? []).includes(rowIndex)
            ? null
            : ((column.numbers?.values ?? column.texts?.values ?? [])[rowIndex] ?? null),
        ),
      })),
    };
    const name = request.stream.slice(8);
    const result = await this.raw.store(
      name,
      day,
      upload,
      request.columns.map((column: ColumnInput) => ({
        name: column.name,
        type: column.numbers ? "number" : "text",
      })),
    );
    if (!result.ok) {
      invalidArgument(result.error);
    }
    this.onSamples(name, day);
    const stored = result.value;
    return {
      rows: String(stored.rows),
      added: String(stored.added),
      replaced: String(stored.replaced),
    };
  };
}

function validateColumns(columns: ColumnInput[], rowCount: number) {
  const names = new Set<string>();
  for (const column of columns) {
    if (names.has(column.name)) {
      invalidArgument("duplicate column name");
    }
    names.add(column.name);
    validateColumn(column, rowCount);
  }
}

function validateColumn(column: ColumnInput, rowCount: number) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(column.name) || column.name === "ts") {
    invalidArgument("invalid column name");
  }
  if (Boolean(column.numbers) === Boolean(column.texts)) {
    invalidArgument("exactly one values type required");
  }
  const values = column.numbers?.values ?? column.texts?.values ?? [];
  if (
    values.length !== rowCount ||
    values.some((stored: unknown) => !validCell(stored, Boolean(column.numbers)))
  ) {
    invalidArgument("invalid column values");
  }
  if (
    (column.missingRows ?? []).some(
      (rowIndex: number) => !Number.isInteger(rowIndex) || rowIndex < 0 || rowIndex >= rowCount,
    )
  ) {
    invalidArgument("invalid missing row");
  }
}

function validCell(value: unknown, numeric: boolean) {
  if (numeric) {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === "string";
}

function uploadTimestamps(request: SampleUpload, day: string): number[] {
  const start = Date.parse(day);
  if (
    !(
      Array.isArray(request.timestamps) &&
      request.timestamps.length > 0 &&
      Array.isArray(request.columns) &&
      request.columns.length > 0
    )
  ) {
    invalidArgument("timestamps and columns required");
  }
  const timestamps = request.timestamps.map(Number);
  if (
    timestamps.some(
      (timestamp: number) =>
        !Number.isSafeInteger(timestamp) || timestamp < start || timestamp >= start + 86400000,
    )
  ) {
    invalidArgument("timestamps must fall in UTC day");
  }
  return timestamps;
}
