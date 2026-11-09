// The capture box's state and what it shows, kept apart from the component so it can be tested.
// The parsing itself is the shared parser in src/capture, the same one the server runs.

import { type CaptureKind, type CaptureParse, parseCapture } from "../../src/capture/parse";
import { hhmm, isoDate, wallClock } from "../../src/capture/zone";
import { shortDate } from "./format";

/** What's typed, and the kind if it was switched by hand. */
export interface BoxState {
  text: string;
  override?: CaptureKind;
}

/** A run of the typed text, highlighted when it is a time ("when") or a person ("who"). */
export interface Segment {
  text: string;
  kind?: "when" | "who";
}

export interface Preview {
  parse: CaptureParse;
  reason: string;
  /** "Today · 12:30–13:30", "Fri 13 Nov · 10:00" or "Someday". */
  when: string;
  /** Where it will land, e.g. "Inbox". */
  where: string;
}

export interface Context {
  now: Date;
  timeZone: string;
  /** False until a calendar is connected: everything is a reminder. */
  eventsEnabled: boolean;
}

/** Typing keeps a hand switch; clearing the box drops it. */
export function typed(state: BoxState, text: string): BoxState {
  return text.trim() ? { ...state, text } : { text };
}

export function switched(state: BoxState, kind: CaptureKind): BoxState {
  return { ...state, override: kind };
}

/** The text cut into plain and highlighted runs, covering every character once. */
export function segments(text: string, parse: CaptureParse | undefined): Segment[] {
  const runs: Segment[] = [];
  let at = 0;
  for (const span of parse?.spans ?? []) {
    if (span.start > at) {
      runs.push({ text: text.slice(at, span.start) });
    }
    runs.push({ text: text.slice(span.start, span.end), kind: span.kind });
    at = span.end;
  }
  if (at < text.length) {
    runs.push({ text: text.slice(at) });
  }
  return runs;
}

const NO_CALENDAR = "It reads as an event, but no calendar is connected yet, so it's a reminder.";

export function preview(state: BoxState, context: Context): Preview | undefined {
  const kind = context.eventsEnabled ? state.override : "reminder";
  const parse = parseCapture(state.text, { now: context.now, timeZone: context.timeZone, kind });
  if (!parse) {
    return undefined;
  }
  const readAsEvent = !context.eventsEnabled && parse.autoKind === "event";
  return {
    parse,
    reason: readAsEvent && !state.override ? NO_CALENDAR : parse.reason,
    when: whenLabel(parse, context),
    where: "Inbox",
  };
}

function whenLabel(parse: CaptureParse, context: Context): string {
  if (parse.start && parse.end) {
    const start = wallClock(parse.start, context.timeZone);
    const end = wallClock(parse.end, context.timeZone);
    const day = dayName(isoDate(start), context);
    return `${day} · ${hhmm(start.hour, start.minute)}–${hhmm(end.hour, end.minute)}`;
  }
  if (!parse.dueDate) {
    return "Someday";
  }
  const day = dayName(parse.dueDate, context);
  return parse.dueTime ? `${day} · ${parse.dueTime}` : day;
}

function dayName(date: string, context: Context): string {
  const today = wallClock(context.now, context.timeZone);
  const tomorrow = wallClock(new Date(context.now.getTime() + 86_400_000), context.timeZone);
  if (date === isoDate(today)) {
    return "Today";
  }
  if (date === isoDate(tomorrow)) {
    return "Tomorrow";
  }
  return shortDate(date);
}

/** The CreateTask body for a reminder, so the task saved is the one the preview showed. */
export function taskFields(parse: CaptureParse) {
  const [year, month, day] = (parse.dueDate ?? "").split("-").map(Number);
  const [hours, minutes] = (parse.dueTime ?? "").split(":").map(Number);
  return {
    description: parse.title,
    ...(parse.dueDate && { dueDate: { year, month, day } }),
    ...(parse.dueTime && { dueTime: { hours, minutes } }),
    ...(parse.recurrence && { recurrence: parse.recurrence }),
  };
}
