// Pulls a due date and time out of spoken text ("call the bank tomorrow at 9") with chrono.
// Deterministic on purpose: the same words always give the same date.

import * as chrono from "chrono-node";
import { hhmm, isoDate, offsetMinutes } from "./zone";

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
  const due = isoDate({
    year: start.get("year") ?? 0,
    month: start.get("month") ?? 1,
    day: start.get("day") ?? 1,
  });
  const time = start.isCertain("hour")
    ? hhmm(start.get("hour") ?? 0, start.get("minute") ?? 0)
    : undefined;
  return { description: removePhrase(text, found.index, found.text), due, time };
}

/** Cut the date phrase out, plus a dangling "on", "at" or "by" before it. */
function removePhrase(text: string, index: number, phrase: string): string {
  const before = text.slice(0, index).replace(/\s+(?:on|at|by)\s*$/i, "");
  const after = text.slice(index + phrase.length);
  return `${before} ${after}`.replace(/\s+/g, " ").trim();
}
