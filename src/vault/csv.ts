// Minimal CSV handling for health metrics. Values are numbers and slugs only (validated by
// callers), so no quoting or escaping is needed.

type Row = Record<string, string>;

interface Table {
  columns: Set<string>;
  /** Rows keyed by their `date` cell. */
  rows: Map<string, Row>;
}

/**
 * Insert or replace the row for `date`, keeping existing metrics that aren't in `metrics`.
 * Columns are: date, the metrics sorted by name, then source.
 */
export function upsertCsvRow(
  text: string | null,
  date: string,
  metrics: Record<string, number>,
  source: string,
): string {
  const table = parseTable(text);
  const row: Row = { ...table.rows.get(date), date, source };
  for (const [name, value] of Object.entries(metrics)) {
    row[name] = String(value);
  }
  table.rows.set(date, row);
  for (const column of Object.keys(row)) {
    table.columns.add(column);
  }
  return renderTable(table);
}

function parseTable(text: string | null): Table {
  const table: Table = { columns: new Set(), rows: new Map() };
  if (!text) {
    return table;
  }
  const [headerLine = "", ...lines] = text.trim().split("\n");
  const header = headerLine.split(",");
  for (const column of header) {
    table.columns.add(column);
  }
  for (const line of lines) {
    const cells = line.split(",");
    const row = Object.fromEntries(header.map((column, i) => [column, cells[i] ?? ""]));
    if (row.date) {
      table.rows.set(row.date, row);
    }
  }
  return table;
}

function renderTable(table: Table): string {
  const metricColumns = [...table.columns].filter((c) => c !== "date" && c !== "source").sort();
  const header = ["date", ...metricColumns, "source"];
  const dates = [...table.rows.keys()].sort();
  const lines = dates.map((date) => {
    const row = table.rows.get(date) ?? {};
    return header.map((column) => row[column] ?? "").join(",");
  });
  return `${[header.join(","), ...lines].join("\n")}\n`;
}
