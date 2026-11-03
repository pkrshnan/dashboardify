// Pulls a due date and time out of spoken text ("call the bank tomorrow at 9") with chrono.
// Deterministic on purpose: the same words always give the same date.

import * as chrono from "chrono-node";

export interface When {
  /** The text with the date phrase removed. */
  description: string;
  due?: string;
  time?: string;
}

/**
 * Find the first date phrase in `text`, read relative to `now` in `timeZone`. Only parts the
 * speaker actually said are used: "tomorrow" sets a date but no time.
 */
export function parseWhen(text: string, now: Date, timeZone: string): When {
  const reference = { instant: now, timezone: offsetMinutes(now, timeZone) };
  const [found] = chrono.parse(text, reference, { forwardDate: true });
  if (!found) {
    return { description: text.trim() };
  }
  const start = found.start;
  const due = Temporal.PlainDate.from({
    year: start.get("year") ?? 0,
    month: start.get("month") ?? 1,
    day: start.get("day") ?? 1,
  }).toString();
  const time = start.isCertain("hour")
    ? hhmm(start.get("hour") ?? 0, start.get("minute") ?? 0)
    : undefined;
  return { description: removePhrase(text, found.index, found.text), due, time };
}

function offsetMinutes(at: Date, timeZone: string): number {
  const zoned = Temporal.Instant.fromEpochMilliseconds(at.getTime()).toZonedDateTimeISO(timeZone);
  return zoned.offsetNanoseconds / 60_000_000_000;
}

function hhmm(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

/** Cut the date phrase out, plus a dangling "on", "at" or "by" before it. */
function removePhrase(text: string, index: number, phrase: string): string {
  const before = text.slice(0, index).replace(/\s+(?:on|at|by)\s*$/i, "");
  const after = text.slice(index + phrase.length);
  return `${before} ${after}`.replace(/\s+/g, " ").trim();
}
