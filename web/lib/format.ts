// Dates as the design writes them: day-month ("3 Nov"), 24-hour times. Every date here is a
// YYYY-MM-DD string from the server, formatted in UTC so the browser's own time zone never
// shifts it by a day.

function utc(date: string): Date {
  return new Date(`${date}T00:00:00Z`);
}

function fmt(date: string, options: Intl.DateTimeFormatOptions): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone: "UTC", ...options }).format(utc(date));
}

/** "Tuesday 3 November" */
export function longDate(date: string): string {
  return fmt(date, { weekday: "long", day: "numeric", month: "long" });
}

/** "Tue 3 Nov" */
export function shortDate(date: string): string {
  return fmt(date, { weekday: "short", day: "numeric", month: "short" });
}

/** "Tue 3" */
export function dayLabel(date: string): string {
  return fmt(date, { weekday: "short", day: "numeric" });
}

export function weekday(date: string): string {
  return fmt(date, { weekday: "short" });
}

export function dayOfMonth(date: string): string {
  return String(utc(date).getUTCDate());
}

/** "3 Nov", or "3 Nov 2025" with the year. */
export function dayMonth(date: string, withYear = false): string {
  return fmt(
    date,
    withYear
      ? { day: "numeric", month: "short", year: "numeric" }
      : { day: "numeric", month: "short" },
  );
}

/** "3–9 Nov", or "28 Nov – 4 Dec" across a month. */
export function dateSpan(first: string, last: string): string {
  if (first.slice(0, 7) === last.slice(0, 7)) {
    return `${dayOfMonth(first)}–${dayMonth(last)}`;
  }
  return `${dayMonth(first)} – ${dayMonth(last)}`;
}

/** The date `days` after `date` (negative for before). */
export function addDays(date: string, days: number): string {
  const d = utc(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "in 48 min", "in 2h 05m", or "now". */
export function startsIn(minutes: number): string {
  if (minutes <= 0) {
    return "now";
  }
  if (minutes < 60) {
    return `in ${minutes} min`;
  }
  return `in ${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
}

/** Minutes after midnight as "HH". */
export function hourLabel(hour: number): string {
  return String(hour % 24).padStart(2, "0");
}
