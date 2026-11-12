// Which day a habit tick belongs to. Days follow the server's time zone, and the habit day runs
// until 04:00, so reading at 00:40 counts for the evening it was part of (docs/habits.md).

export const DAY_ENDS_AT_HOUR = 4;

/** YYYY-MM-DD of the habit day `at` falls in. */
export function habitDay(at: Date, timeZone: string): string {
  const zoned = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
  const date = zoned.toPlainDate();
  return (zoned.hour < DAY_ENDS_AT_HOUR ? date.subtract({ days: 1 }) : date).toString();
}

/** Every date from `from` to `to`, both included; empty when `to` is before `from`. */
export function datesBetween(from: string, to: string): string[] {
  const dates: string[] = [];
  const end = Temporal.PlainDate.from(to);
  for (let d = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(d, end) <= 0; ) {
    dates.push(d.toString());
    d = d.add({ days: 1 });
  }
  return dates;
}
