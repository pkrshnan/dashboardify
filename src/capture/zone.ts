// Time zone math with Intl only, so the same code runs on the server and in any browser.
// Temporal would be simpler, but it isn't in every browser the phone may use.

/** A wall-clock date and time, with no zone. Months are 1-12. */
export interface WallClock {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatter(timeZone: string): Intl.DateTimeFormat {
  let found = formatters.get(timeZone);
  if (!found) {
    found = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "numeric",
      day: "numeric",
      hour: "numeric",
      minute: "numeric",
      second: "numeric",
    });
    formatters.set(timeZone, found);
  }
  return found;
}

/** The wall clock in `timeZone` at the instant `at`. */
export function wallClock(at: Date, timeZone: string): WallClock {
  const parts: Record<string, number> = {};
  for (const part of formatter(timeZone).formatToParts(at)) {
    if (part.type !== "literal") {
      parts[part.type] = Number(part.value);
    }
  }
  return {
    year: parts.year ?? 0,
    month: parts.month ?? 1,
    day: parts.day ?? 1,
    hour: parts.hour ?? 0,
    minute: parts.minute ?? 0,
  };
}

/** Minutes east of UTC for `timeZone` at the instant `at` (London in summer is 60). */
export function offsetMinutes(at: Date, timeZone: string): number {
  const clock = wallClock(at, timeZone);
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  const wholeMinute = Math.floor(at.getTime() / 60_000) * 60_000;
  return Math.round((asUtc - wholeMinute) / 60_000);
}

/**
 * The instant a wall clock reads `clock` in `timeZone`. A time skipped by a DST jump moves
 * forward by the jump; a repeated time takes the first of the two.
 */
export function instantAt(clock: WallClock, timeZone: string): Date {
  const asUtc = Date.UTC(clock.year, clock.month - 1, clock.day, clock.hour, clock.minute);
  const before = offsetMinutes(new Date(asUtc - 86_400_000), timeZone);
  const after = offsetMinutes(new Date(asUtc + 86_400_000), timeZone);
  const early = new Date(asUtc - Math.max(before, after) * 60_000);
  const late = new Date(asUtc - Math.min(before, after) * 60_000);
  for (const candidate of [early, late]) {
    if (sameClock(wallClock(candidate, timeZone), clock)) {
      return candidate;
    }
  }
  // Skipped by a spring-forward jump: read it with the offset from before the jump.
  return new Date(asUtc - before * 60_000);
}

function sameClock(a: WallClock, b: WallClock): boolean {
  return (
    a.year === b.year &&
    a.month === b.month &&
    a.day === b.day &&
    a.hour === b.hour &&
    a.minute === b.minute
  );
}

/** YYYY-MM-DD. */
export function isoDate(clock: Pick<WallClock, "year" | "month" | "day">): string {
  return `${clock.year}-${pad(clock.month)}-${pad(clock.day)}`;
}

/** HH:MM, 24-hour. */
export function hhmm(hour: number, minute: number): string {
  return `${pad(hour)}:${pad(minute)}`;
}

function pad(value: number): string {
  return String(value).padStart(2, "0");
}
