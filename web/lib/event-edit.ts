// The event panel's form, as plain data so the rules can be tested: times are edited as wall
// clocks in the server's time zone, moving the start keeps the length, and only changed fields
// are sent.

import { hhmm, instantAt, isoDate, wallClock } from "../../src/capture/zone";
import type { EventDetail } from "../api";
import { addDays, dateSpan, shortDate } from "./format";

export interface EventForm {
  title: string;
  /** "YYYY-MM-DDTHH:MM", as a datetime-local input holds it. */
  start: string;
  end: string;
  location: string;
  notes: string;
}

export type EventChange = Partial<
  Pick<EventDetail, "title" | "startTime" | "endTime" | "location" | "notes">
>;

/** Why the event can't be changed here, or null when it can. */
export function readOnlyReason(event: EventDetail): string | null {
  if (event.recurring) {
    return "This event repeats. Change it in Apple Calendar.";
  }
  if (!event.writable) {
    return "This calendar is read-only here.";
  }
  return null;
}

/** "Tue 3 Nov · 12:30–13:30", "Tue 3 Nov, 23:00 – Wed 4 Nov, 01:00", or "Tue 3 Nov · All day". */
export function whenLabel(event: EventDetail, timeZone: string): string {
  const start = local(new Date(event.startTime), timeZone);
  const end = local(new Date(event.endTime), timeZone);
  if (event.allDay) {
    // All-day ends are the midnight after the last day.
    const last = addDays(end.date, -1);
    return `${last > start.date ? dateSpan(start.date, last) : shortDate(start.date)} · All day`;
  }
  if (start.date === end.date) {
    return `${shortDate(start.date)} · ${start.time}–${end.time}`;
  }
  return `${shortDate(start.date)}, ${start.time} – ${shortDate(end.date)}, ${end.time}`;
}

export function formFor(event: EventDetail, timeZone: string): EventForm {
  return {
    title: event.title,
    start: localInput(new Date(event.startTime), timeZone),
    end: localInput(new Date(event.endTime), timeZone),
    location: event.location,
    notes: event.notes,
  };
}

/** A new start moves the end with it, so the event keeps its length. */
export function moveStart(form: EventForm, start: string, timeZone: string): EventForm {
  const from = fromInput(form.start, timeZone);
  const to = fromInput(start, timeZone);
  const end = fromInput(form.end, timeZone);
  if (!(from && to && end)) {
    return { ...form, start };
  }
  const moved = new Date(end.getTime() + (to.getTime() - from.getTime()));
  return { ...form, start, end: localInput(moved, timeZone) };
}

/** The fields that differ from the event, or an error to show instead. */
export function changeFrom(
  event: EventDetail,
  form: EventForm,
  timeZone: string,
): { change: EventChange } | { error: string } {
  const change: EventChange = {};
  const title = form.title.trim();
  if (!title) {
    return { error: "Give it a title." };
  }
  if (title !== event.title) {
    change.title = title;
  }
  for (const field of ["location", "notes"] as const) {
    if (form[field].trim() !== event[field].trim()) {
      change[field] = form[field].trim();
    }
  }
  if (event.allDay) {
    return { change };
  }
  const times = timeChange(event, form, timeZone);
  return "error" in times ? times : { change: { ...change, ...times.change } };
}

function timeChange(
  event: EventDetail,
  form: EventForm,
  timeZone: string,
): { change: EventChange } | { error: string } {
  const change: EventChange = {};
  const start = fromInput(form.start, timeZone);
  const end = fromInput(form.end, timeZone);
  if (!(start && end)) {
    return { error: "Pick a start and an end." };
  }
  if (end <= start) {
    return { error: "It has to end after it starts." };
  }
  // The form holds whole minutes; an event stored with seconds is unchanged until moved.
  if (!sameMinute(start, event.startTime)) {
    change.startTime = start.toISOString();
  }
  if (!sameMinute(end, event.endTime)) {
    change.endTime = end.toISOString();
  }
  return { change };
}

function sameMinute(at: Date, iso: string): boolean {
  return Math.floor(at.getTime() / 60_000) === Math.floor(new Date(iso).getTime() / 60_000);
}

function local(at: Date, timeZone: string): { date: string; time: string } {
  const clock = wallClock(at, timeZone);
  return { date: isoDate(clock), time: hhmm(clock.hour, clock.minute) };
}

function localInput(at: Date, timeZone: string): string {
  const { date, time } = local(at, timeZone);
  return `${date}T${time}`;
}

function fromInput(value: string, timeZone: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/.exec(value);
  if (!match) {
    return null;
  }
  const [year, month, day, hour, minute] = match.slice(1).map(Number) as [
    number,
    number,
    number,
    number,
    number,
  ];
  return instantAt({ year, month, day, hour, minute }, timeZone);
}
