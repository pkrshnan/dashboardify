// Calendar helpers built on Temporal, which handles time zones and DST for us.

/** The wall-clock date and time of `at` in an IANA time zone. */
function zoned(at: Date, timeZone: string): Temporal.ZonedDateTime {
  return Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
}

/** YYYY-MM-DD for `at` in the given time zone. */
export function localDate(at: Date, timeZone: string): string {
  return zoned(at, timeZone).toPlainDate().toString();
}

/** HH:MM (24h) for `at` in the given time zone. */
export function localTime(at: Date, timeZone: string): string {
  return zoned(at, timeZone).toPlainTime().toString({ smallestUnit: "minute" });
}

/** True for a real calendar date written exactly as YYYY-MM-DD. */
export function isIsoDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  try {
    Temporal.PlainDate.from(value, { overflow: "reject" });
    return true;
  } catch {
    return false;
  }
}
