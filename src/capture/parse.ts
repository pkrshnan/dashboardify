// Reads one line from the capture box and decides whether it is a calendar event or a reminder.
// Pure: the same text, clock and zone always give the same answer, so the web app can run it on
// every keystroke and the server can run it again before writing.

import * as chrono from "chrono-node";
import { hhmm, instantAt, isoDate, offsetMinutes, type WallClock, wallClock } from "./zone";

export type CaptureKind = "event" | "reminder";

/** A highlighted phrase, as [start, end) in UTF-16 code units of the original text. */
export interface CaptureSpan {
  start: number;
  end: number;
  kind: "when" | "who" | "where";
}

export interface CaptureParse {
  kind: CaptureKind;
  /** What the rules chose, before any switch by hand. */
  autoKind: CaptureKind;
  /** One sentence for the preview line: why it is this kind. */
  reason: string;
  title: string;
  /** Events only. */
  start?: Date;
  end?: Date;
  /** Reminders only: YYYY-MM-DD, HH:MM and a Tasks rule such as "every week". */
  dueDate?: string;
  dueTime?: string;
  recurrence?: string;
  /** Events only: where, as typed ("Dishoom" from "at Dishoom" or "@Dishoom"). */
  place?: string;
  spans: CaptureSpan[];
}

export interface CaptureOptions {
  now: Date;
  timeZone: string;
  /** Set only when the kind was switched by hand. */
  kind?: CaptureKind;
}

/** Events with no end or length get this long. */
const DEFAULT_EVENT_MINUTES = 60;

/** An event switched on by hand with no time starts here. */
const DEFAULT_EVENT_HOUR = 9;

const VERBS = new Set([
  "call",
  "email",
  "text",
  "pay",
  "buy",
  "book",
  "send",
  "pick",
  "remind",
  "renew",
  "submit",
  "take",
  "check",
  "order",
  "cancel",
  "reply",
  "message",
  "fix",
  "clean",
  "water",
  "finish",
  "write",
  "get",
  "return",
]);

const APPOINTMENT =
  /\b(lunch|dinner|breakfast|brunch|coffee|drinks|meeting|standup|stand-up|sync|interview|appointment|dentist|doctor|physio|haircut|gym|run|swim|yoga|class|flight|party|concert|review|workshop)\b/i;

const WHO = /\bwith\s+\p{Lu}[\p{L}'-]*(?:\s+(?:and|&)\s+\p{Lu}[\p{L}'-]*)?/u;

const DURATION =
  /\bfor\s+(half an|an?|one|\d+(?:\.\d+)?)\s*(h|hrs?|hours?|m|mins?|minutes?)(?![\p{L}\d])/iu;

const UNITS = ["day", "weekday", "week", "month", "year"];

/**
 * "@Dishoom", "@ 10 Downing St", "at Dishoom", "at the Barbican": "at" needs a capital after it,
 * so "at 3pm" and "at noon" stay times.
 */
const PLACE = /(?:^|\s)(@\s*(?=\S)|at\s+(?=(?:the\s+)?\p{Lu}))/gu;

/** A place ends at the next highlighted phrase, or at one of these. */
const PLACE_END = /[,;.!?]|\s(?:on|from|by|to|until)\s*$/u;

const RECURRENCE =
  /\bevery\s+(day|weekday|week|month|year|monday|tuesday|wednesday|thursday|friday|saturday|sunday)\b/i;

/** "12-1" and "9:30–10": a time range with no am or pm, which chrono leaves alone. */
const bareRange: chrono.Parser = {
  pattern: () =>
    /(?<![\d:/.-])(\d{1,2})(?::(\d{2}))?\s*[-–]\s*(\d{1,2})(?::(\d{2}))?(?![\d:/.]|\s*[ap]\.?m\b)/i,
  extract: (context, match) => {
    const [startHour, startMinute, endHour, endMinute] = [1, 2, 3, 4].map((i) =>
      Number(match[i] ?? 0),
    ) as [number, number, number, number];
    if (startHour > 23 || endHour > 23 || startMinute > 59 || endMinute > 59) {
      return null;
    }
    return context.createParsingResult(
      match.index ?? 0,
      match[0],
      { hour: startHour, minute: startMinute },
      { hour: endHour, minute: endMinute },
    );
  },
};

const parser = chrono.casual.clone();
parser.parsers.push(bareRange);

interface Found {
  date?: Pick<WallClock, "year" | "month" | "day">;
  start?: Minutes;
  end?: Minutes;
  length?: number;
  recurrence?: string;
  who: boolean;
  place?: string;
  spans: CaptureSpan[];
}

/** Minutes after midnight, and whether am or pm was said. */
interface Minutes {
  value: number;
  meridiem: boolean;
}

/** Parse one line. Returns undefined for a blank line. */
export function parseCapture(text: string, options: CaptureOptions): CaptureParse | undefined {
  if (!text.trim()) {
    return undefined;
  }
  const found = findParts(text, options);
  const [autoKind, autoReason] = classify(text, found);
  const kind = options.kind ?? autoKind;
  const reason = kind === autoKind ? autoReason : switchedReason(autoKind);
  // A reminder has nowhere to put a place, so it stays in the title.
  const spans = kind === "event" ? found.spans : found.spans.filter((s) => s.kind !== "where");
  const place = kind === "event" ? found.place : undefined;
  const base = {
    kind,
    autoKind,
    reason,
    title: titleOf(text, spans),
    spans,
    ...(place && { place }),
  };
  return kind === "event"
    ? { ...base, ...eventTimes(found, options) }
    : { ...base, ...reminderDue(found, options) };
}

function findParts(text: string, options: CaptureOptions): Found {
  const duration = DURATION.exec(text);
  const recurrence = RECURRENCE.exec(text);
  const who = WHO.exec(text);
  const hidden = hiddenFromChrono(duration, recurrence);
  const found: Found = {
    length: duration ? durationMinutes(duration) : undefined,
    recurrence: recurrence ? recurrenceRule(recurrence[1] ?? "") : undefined,
    who: who !== null,
    spans: [duration, recurrence].flatMap((match) => (match ? [spanOf(match, "when")] : [])),
  };
  if (who) {
    found.spans.push(spanOf(who, "who"));
  }
  readTimes(maskSpans(text, hidden), options, found);
  found.spans = mergeSpans(found.spans);
  const place = findPlace(text, found.spans);
  if (place) {
    found.place = place.text;
    found.spans = [...found.spans, place.span].sort((a, b) => a.start - b.start);
  }
  return found;
}

/** The first "at Place" or "@Place" outside the other phrases. Its span includes the "at". */
function findPlace(text: string, spans: CaptureSpan[]) {
  for (const match of text.matchAll(PLACE)) {
    const marker = match[1] ?? "";
    const start = (match.index ?? 0) + match[0].length - marker.length;
    const from = start + marker.length;
    if (!spans.some((s) => s.start <= from && from < s.end)) {
      const place = placeText(text, from, spans);
      if (place) {
        return {
          text: place.replace(/^the\s+/i, ""),
          span: { start, end: from + place.length, kind: "where" as const },
        };
      }
    }
  }
  return undefined;
}

/** From `from` to the next phrase or stop word, or nothing if that's empty or too long. */
function placeText(text: string, from: number, spans: CaptureSpan[]): string | undefined {
  const next = spans.find((s) => s.start >= from)?.start ?? text.length;
  const rest = text.slice(from, next);
  const stop = PLACE_END.exec(rest);
  const place = (stop ? rest.slice(0, stop.index) : rest).trimEnd();
  return place && place.length <= 100 ? place : undefined;
}

/**
 * Phrases chrono would misread: it takes "for 1h" as "in an hour". In "every Monday" only
 * "every" is hidden, so chrono still finds the next Monday.
 */
function hiddenFromChrono(
  duration: RegExpExecArray | null,
  recurrence: RegExpExecArray | null,
): CaptureSpan[] {
  const hidden = duration ? [spanOf(duration, "when")] : [];
  if (recurrence) {
    const weekday = !UNITS.includes(recurrence[1]?.toLowerCase() ?? "");
    const end = weekday
      ? recurrence.index + "every".length
      : recurrence.index + recurrence[0].length;
    hidden.push({ start: recurrence.index, end, kind: "when" });
  }
  return hidden;
}

function spanOf(match: RegExpExecArray, kind: CaptureSpan["kind"]): CaptureSpan {
  return { start: match.index, end: match.index + match[0].length, kind };
}

function maskSpans(text: string, spans: CaptureSpan[]): string {
  let masked = text;
  for (const span of spans) {
    masked =
      masked.slice(0, span.start) + " ".repeat(span.end - span.start) + masked.slice(span.end);
  }
  return masked;
}

function durationMinutes(match: RegExpExecArray): number {
  const amount = (match[1] ?? "").toLowerCase();
  let count = Number(amount);
  if (amount === "half an") {
    count = 0.5;
  } else if (Number.isNaN(count)) {
    count = 1;
  }
  const hours = (match[2] ?? "").toLowerCase().startsWith("h");
  return Math.round(hours ? count * 60 : count);
}

function recurrenceRule(word: string): string {
  const unit = word.toLowerCase();
  // "every Monday" is weekly, first due on the Monday chrono found.
  return UNITS.includes(unit) ? `every ${unit}` : "every week";
}

function readTimes(masked: string, options: CaptureOptions, found: Found): void {
  const reference = {
    instant: options.now,
    timezone: offsetMinutes(options.now, options.timeZone),
  };
  for (const result of parser.parse(masked, reference, { forwardDate: true })) {
    found.spans.push({ start: result.index, end: result.index + result.text.length, kind: "when" });
    found.date ??= dateOf(result.start);
    if (found.start === undefined && result.start.isCertain("hour")) {
      found.start = minutesOf(result.start);
      found.end = result.end?.isCertain("hour") ? minutesOf(result.end) : undefined;
    }
  }
}

/** The date, if the words named a day ("Fri", "tomorrow") rather than chrono assuming today. */
function dateOf(component: chrono.ParsedComponents): Found["date"] {
  if (!(component.isCertain("day") || component.isCertain("weekday"))) {
    return undefined;
  }
  return {
    year: component.get("year") ?? 0,
    month: component.get("month") ?? 1,
    day: component.get("day") ?? 1,
  };
}

function minutesOf(component: chrono.ParsedComponents): Minutes {
  const hour = component.get("hour") ?? 0;
  const minute = component.get("minute") ?? 0;
  return { value: hour * 60 + minute, meridiem: component.isCertain("meridiem") };
}

/** Overlapping "when" phrases become one; a "who" phrase inside a "when" one is dropped. */
function mergeSpans(spans: CaptureSpan[]): CaptureSpan[] {
  const sorted = [...spans].sort((a, b) => a.start - b.start || b.end - a.end);
  const merged: CaptureSpan[] = [];
  for (const span of sorted) {
    const last = merged.at(-1);
    if (last && span.start < last.end) {
      if (last.kind === "when" && span.kind === "when") {
        last.end = Math.max(last.end, span.end);
      }
      continue;
    }
    merged.push({ ...span });
  }
  return merged;
}

/** A rule gives its reason when it applies, and something falsy when it does not. */
type Rule = (found: Found, firstWord: string, text: string) => string | false | undefined;

const timed = (found: Found) => found.start !== undefined;

/** Checked in order; the first that gives a reason decides the kind. */
const RULES: [CaptureKind, Rule][] = [
  [
    "reminder",
    (found) => found.recurrence && "It repeats, so it's a reminder. Recurring events come later.",
  ],
  [
    "event",
    (found) =>
      timed(found) &&
      (found.end !== undefined || found.length !== undefined) &&
      "It has an end time or a length, so it blocks time.",
  ],
  [
    "reminder",
    (_, firstWord) =>
      VERBS.has(firstWord) && `It starts with a verb (“${firstWord}”), so it's something to do.`,
  ],
  [
    "event",
    (found) => timed(found) && found.who && "It's with someone, so it's an event. It gets an hour.",
  ],
  [
    "event",
    (found) => timed(found) && found.place && "It's at a place, so it's an event. It gets an hour.",
  ],
  [
    "event",
    (found, _, text) => {
      const word = APPOINTMENT.exec(text)?.[0];
      return (
        timed(found) && word && `“${word}” at a time reads as an appointment. It gets an hour.`
      );
    },
  ],
  ["reminder", (found) => timed(found) && "A time with no length is a reminder."],
  ["reminder", (found) => found.date && "A day with no time is a dated task."],
];

function classify(text: string, found: Found): [CaptureKind, string] {
  const firstWord = text.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  for (const [kind, rule] of RULES) {
    const reason = rule(found, firstWord, text);
    if (reason) {
      return [kind, reason];
    }
  }
  return ["reminder", "No date or time, so it's a task for Someday."];
}

function switchedReason(autoKind: CaptureKind): string {
  const read = autoKind === "event" ? "an event" : "a reminder";
  return `Read as ${read}, switched by hand. The switch holds until the box is cleared.`;
}

/**
 * The start and end in minutes after midnight. Without am or pm, 1–6 means the afternoon
 * ("lunch 12-1", "drinks at 6"), and an end before its start is in the afternoon or next day.
 */
function clockMinutes(found: Found): { start: number; end?: number } | undefined {
  if (!found.start) {
    return undefined;
  }
  const start =
    found.start.value +
    (!found.start.meridiem && found.start.value >= 60 && found.start.value < 420 ? 720 : 0);
  if (found.end) {
    return { start, end: endAfter(start, found.end) };
  }
  return { start, end: found.length === undefined ? undefined : start + found.length };
}

function endAfter(start: number, end: Minutes): number {
  let value = end.value;
  if (value <= start && !end.meridiem) {
    value += 720;
  }
  if (value <= start) {
    value += end.meridiem ? 1440 : 720;
  }
  return value;
}

/** The day: the one that was said, else today, else tomorrow if the time has passed today. */
function dayOf(found: Found, startMinutes: number | undefined, options: CaptureOptions) {
  if (found.date) {
    return found.date;
  }
  const today = wallClock(options.now, options.timeZone);
  if (startMinutes === undefined || at(today, startMinutes, options.timeZone) >= options.now) {
    return today;
  }
  return wallClock(new Date(options.now.getTime() + 86_400_000), options.timeZone);
}

function at(day: Pick<WallClock, "year" | "month" | "day">, minutes: number, timeZone: string) {
  const extraDays = Math.floor(minutes / 1440);
  const date = new Date(Date.UTC(day.year, day.month - 1, day.day + extraDays));
  const clock = {
    year: date.getUTCFullYear(),
    month: date.getUTCMonth() + 1,
    day: date.getUTCDate(),
    hour: Math.floor((minutes % 1440) / 60),
    minute: minutes % 60,
  };
  return instantAt(clock, timeZone);
}

function eventTimes(found: Found, options: CaptureOptions): Pick<CaptureParse, "start" | "end"> {
  const times = clockMinutes(found);
  const startMinutes = times?.start ?? DEFAULT_EVENT_HOUR * 60;
  const day = dayOf(found, times?.start, options);
  const endMinutes = times?.end ?? startMinutes + (found.length ?? DEFAULT_EVENT_MINUTES);
  return {
    start: at(day, startMinutes, options.timeZone),
    end: at(day, endMinutes, options.timeZone),
  };
}

function reminderDue(
  found: Found,
  options: CaptureOptions,
): Pick<CaptureParse, "dueDate" | "dueTime" | "recurrence"> {
  const times = clockMinutes(found);
  // A repeating task needs a due date to repeat from, so "every day" starts today.
  if (!(times || found.date || found.recurrence)) {
    return {};
  }
  const day = dayOf(found, times?.start, options);
  const dueTime = times ? hhmm(Math.floor(times.start / 60), times.start % 60) : undefined;
  return { dueDate: isoDate(day), dueTime, recurrence: found.recurrence };
}

/**
 * The text with its time phrases (and an "at", "on", "from" or "by" before them) and its place
 * taken out.
 */
function titleOf(text: string, spans: CaptureSpan[]): string {
  let title = text;
  for (const span of [...spans].reverse()) {
    if (span.kind === "who") {
      continue;
    }
    const before = title.slice(0, span.start).replace(/(^|\s)(?:at|on|from|by)\s*$/i, "$1");
    title = `${before} ${title.slice(span.end)}`;
  }
  // A comma left behind by a removed phrase ("Coffee at the Barbican, Thu 3pm") goes too.
  title = title
    .replace(/\s+/g, " ")
    .replace(/\s+([,;])/g, "$1")
    .replace(/^[\s,;]+|[\s,;]+$/g, "");
  return title.charAt(0).toUpperCase() + title.slice(1);
}
