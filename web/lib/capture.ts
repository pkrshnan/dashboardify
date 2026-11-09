// The capture box's state and what it shows, kept apart from the component so it can be tested.
// The parsing itself is the shared parser in src/capture, the same one the server runs.

import { chooseCalendar } from "../../src/capture/choose-calendar";
import { type CaptureKind, type CaptureParse, parseCapture } from "../../src/capture/parse";
import { hhmm, isoDate, wallClock } from "../../src/capture/zone";
import type { CaptureHints } from "../../src/home/calendar";
import type { AgendaEvent, Category, HomeView } from "../../src/home/types";
import type { PlaceView } from "../api";
import { shortDate } from "./format";

/** What's typed, and the kind and calendar if they were picked by hand. */
export interface BoxState {
  text: string;
  override?: CaptureKind;
  /** `calendarAccounts/{a}/calendars/{c}` */
  calendar?: string;
  /** The search result picked for the typed place, while that place stays the same. */
  place?: { query: string; index: number };
}

/** The calendar an event will go on, and why. */
export interface PreviewCalendar {
  name: string;
  displayName: string;
  category: Category;
  reason: string;
}

/** A run of the typed text, highlighted when it is a time, a person or a place. */
export interface Segment {
  text: string;
  kind?: "when" | "who" | "where";
}

export interface Preview {
  parse: CaptureParse;
  reason: string;
  /** "Today · 12:30–13:30", "Fri 13 Nov · 10:00" or "Someday". */
  when: string;
  /** Where it will land: "Inbox", or the calendar's name. */
  where: string;
  /** Events only. */
  calendar?: PreviewCalendar;
  /** Events at a place: the search result that will be saved, filled in by the box. */
  place?: PlaceView;
}

export interface Context {
  now: Date;
  timeZone: string;
  /** Null until a writable calendar is connected: everything is a reminder. */
  hints: CaptureHints | null;
}

/** Typing keeps a hand switch and a picked calendar; clearing the box drops them. */
export function typed(state: BoxState, text: string): BoxState {
  return text.trim() ? { ...state, text } : { text };
}

export function switched(state: BoxState, kind: CaptureKind): BoxState {
  return { ...state, override: kind };
}

/** The calendar after `current` in the writable list, for the preview line's picker. */
export function nextCalendar(state: BoxState, hints: CaptureHints, current: string): BoxState {
  const names = hints.calendars.map((c) => c.name);
  const next = names[(names.indexOf(current) + 1) % names.length] ?? current;
  return { ...state, calendar: next };
}

/** The search result shown for the typed place: the one picked, else the best. */
export function chosenPlace(
  state: BoxState,
  query: string | undefined,
  places: PlaceView[],
): { place?: PlaceView; index: number } {
  const index = query && state.place?.query === query ? state.place.index : 0;
  return { place: query ? places[index % Math.max(places.length, 1)] : undefined, index };
}

/** The next search result, for the place picker. */
export function nextPlace(state: BoxState, query: string, index: number, count: number): BoxState {
  return { ...state, place: { query, index: (index + 1) % Math.max(count, 1) } };
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
  const kind = context.hints ? state.override : "reminder";
  const parse = parseCapture(state.text, { now: context.now, timeZone: context.timeZone, kind });
  if (!parse) {
    return undefined;
  }
  const readAsEvent = !context.hints && parse.autoKind === "event";
  const calendar =
    parse.kind === "event" && context.hints
      ? calendarFor(parse.title, state, context.hints)
      : undefined;
  return {
    parse,
    reason: readAsEvent && !state.override ? NO_CALENDAR : parse.reason,
    when: whenLabel(parse, context),
    where: calendar?.displayName ?? "Inbox",
    calendar,
  };
}

/** A calendar picked by hand, else the same guess the server will make. */
function calendarFor(
  title: string,
  state: BoxState,
  hints: CaptureHints,
): PreviewCalendar | undefined {
  const picked = state.calendar
    ? { calendar: state.calendar, reason: "Picked by hand." }
    : undefined;
  const guess = picked ?? chooseCalendar(title, hints);
  const calendar = hints.calendars.find((c) => c.name === guess?.calendar);
  return calendar && guess ? { ...calendar, reason: guess.reason } : undefined;
}

/**
 * Events still being saved, drawn on their day straight away (with "Saving to iCloud…") and
 * dropped once a refresh brings the real one.
 */
export interface Pending {
  /** The request id, so the block can be dropped when its request ends. */
  key: string;
  date: string;
  event: AgendaEvent;
}

export function withPending(view: HomeView, pending: Pending[]): HomeView {
  if (pending.length === 0) {
    return view;
  }
  const days = view.days.map((day) => {
    const mine = pending.filter((p) => p.date === day.date).map((p) => p.event);
    const events = [...day.events, ...mine].sort((a, b) => a.startMin - b.startMin);
    return mine.length > 0 ? { ...day, events } : day;
  });
  return { ...view, days };
}

/** The timeline block for an event being saved: its own day's minutes, marked pending. */
export function pendingEvent(shown: Preview, timeZone: string, key: string): Pending | undefined {
  const { parse, calendar } = shown;
  if (!(parse.start && parse.end && calendar)) {
    return undefined;
  }
  const start = wallClock(parse.start, timeZone);
  const end = wallClock(parse.end, timeZone);
  const startMin = start.hour * 60 + start.minute;
  const days = Math.round(
    (Date.UTC(end.year, end.month - 1, end.day) -
      Date.UTC(start.year, start.month - 1, start.day)) /
      86_400_000,
  );
  return {
    key,
    date: isoDate(start),
    event: {
      title: parse.title,
      start: hhmm(start.hour, start.minute),
      end: hhmm(end.hour, end.minute),
      startMin,
      endMin: days * 1440 + end.hour * 60 + end.minute,
      detail: "Saving to iCloud…",
      category: calendar.category,
      url: null,
      mapsUrl: null,
      event: null,
      calendar: calendar.name,
      writable: false,
      allDay: false,
      pending: true,
    },
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
