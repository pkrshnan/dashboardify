// Minimal CSV handling for health metrics. Values are numbers and slugs only (validated by
// callers), so no quoting or escaping is needed.

/** Insert or replace the row for `date`. Columns: date, then metrics sorted, then source. */
export function upsertCsvRow(
  text: string | null,
  date: string,
  metrics: Record<string, number>,
  source: string,
): string {
  const rows = new Map<string, Record<string, string>>();
  const columns = new Set<string>();
  if (text) {
    const [header, ...lines] = text.trim().split("\n");
    const cols = (header ?? "").split(",");
    for (const line of lines) {
      const cells = line.split(",");
      const row: Record<string, string> = {};
      cols.forEach((c, i) => {
        row[c] = cells[i] ?? "";
      });
      if (row.date) rows.set(row.date, row);
    }
    for (const c of cols) columns.add(c);
  }
  const row: Record<string, string> = { ...(rows.get(date) ?? {}), date, source };
  for (const [k, v] of Object.entries(metrics)) row[k] = String(v);
  rows.set(date, row);
  for (const c of Object.keys(row)) columns.add(c);

  const metricCols = [...columns].filter((c) => c !== "date" && c !== "source").sort();
  const header = ["date", ...metricCols, "source"];
  const body = [...rows.keys()].sort().map((d) => header.map((c) => rows.get(d)?.[c] ?? "").join(","));
  return `${[header.join(","), ...body].join("\n")}\n`;
}
