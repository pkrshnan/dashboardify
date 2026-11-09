// iCalendar in and out, with ical.js. Reading turns a calendar object (one VEVENT, or a master
// with its overridden instances) into the occurrences inside a window. Writing makes one VEVENT
// with a VTIMEZONE, which is all the capture box creates.

import ICAL from "ical.js";
import { instantAt, offsetMinutes, type WallClock, wallClock } from "../capture/zone";
import type { Place } from "../places/place";

/** One occurrence of an event, as the cache stores it. */
export interface Occurrence {
  uid: string;
  /** For an instance of a recurring event: the original start, as an ISO instant. */
  recurrenceId?: string;
  title: string;
  location: string;
  notes: string;
  url: string;
  start: Date;
  end: Date;
  allDay: boolean;
  /** All-day only: the first day and the day after the last, as YYYY-MM-DD. */
  startDate?: string;
  endDate?: string;
  /** The event's own zone, when it has one; undefined for UTC, floating and all-day times. */
  timeZone?: string;
  recurring: boolean;
}

export interface ReadOptions {
  from: Date;
  to: Date;
  /** Floating times and all-day days are read in this zone (the server's). */
  floatingZone: string;
}

/** Stops a runaway rule (FREQ=MINUTELY with no end) from looping forever. */
const MAX_INSTANCES = 2000;

/** Every occurrence in [from, to) from one iCalendar text. Throws on text that isn't iCalendar. */
export function readOccurrences(ics: string, options: ReadOptions): Occurrence[] {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  const zones = new Map<string, ICAL.Timezone>();
  for (const vtimezone of calendar.getAllSubcomponents("vtimezone")) {
    const zone = new ICAL.Timezone(vtimezone);
    zones.set(zone.tzid, zone);
  }
  const reader = { ...options, zones };
  const events = calendar.getAllSubcomponents("vevent").map((vevent) => new ICAL.Event(vevent));
  const masters = events.filter((event) => !event.isRecurrenceException());
  for (const exception of events.filter((event) => event.isRecurrenceException())) {
    const master = masters.find((event) => event.uid === exception.uid);
    if (master) {
      master.relateException(exception);
    } else {
      // An instance whose master isn't here (a shared calendar can send just that): show it alone.
      masters.push(exception);
    }
  }
  return masters.flatMap((event) =>
    event.isRecurring() ? expand(event, reader) : single(event, reader),
  );
}

type Reader = ReadOptions & { zones: Map<string, ICAL.Timezone> };

function single(event: ICAL.Event, reader: Reader): Occurrence[] {
  const occurrence = occurrenceOf(event, event.startDate, event.endDate, reader);
  if (event.recurrenceId) {
    occurrence.recurrenceId = toInstant(event.recurrenceId, reader).toISOString();
  }
  return overlaps(occurrence, reader) ? [occurrence] : [];
}

function expand(event: ICAL.Event, reader: Reader): Occurrence[] {
  const found: Occurrence[] = [];
  const iterator = event.iterator();
  for (let i = 0; i < MAX_INSTANCES; i++) {
    const next = iterator.next();
    if (!next || toInstant(next, reader) >= reader.to) {
      break;
    }
    const details = event.getOccurrenceDetails(next);
    const occurrence = occurrenceOf(details.item, details.startDate, details.endDate, reader);
    occurrence.recurrenceId = toInstant(details.recurrenceId, reader).toISOString();
    occurrence.recurring = true;
    if (overlaps(occurrence, reader)) {
      found.push(occurrence);
    }
  }
  return found;
}

function occurrenceOf(
  event: ICAL.Event,
  startTime: ICAL.Time,
  endTime: ICAL.Time,
  reader: Reader,
): Occurrence {
  const text = (name: string) => String(event.component.getFirstPropertyValue(name) ?? "");
  const allDay = startTime.isDate;
  return {
    uid: event.uid,
    title: event.summary ?? "",
    location: event.location ?? "",
    notes: event.description ?? "",
    url: text("url"),
    start: toInstant(startTime, reader),
    end: toInstant(endTime, reader),
    allDay,
    startDate: allDay ? startTime.toString() : undefined,
    endDate: allDay ? endTime.toString() : undefined,
    timeZone: allDay ? undefined : zoneName(startTime),
    recurring: false,
  };
}

function overlaps(occurrence: Occurrence, reader: Reader): boolean {
  return occurrence.end > reader.from && occurrence.start < reader.to;
}

/** The TZID a time was written with, if any. */
function zoneName(time: ICAL.Time): string | undefined {
  const named = (time as ICAL.Time & { timezone?: string }).timezone;
  const tzid = named ?? time.zone?.tzid;
  return tzid && tzid !== "floating" && tzid !== "UTC" && tzid !== "Z" ? tzid : undefined;
}

/**
 * The instant for an iCalendar time. IANA zones go through Intl, which knows every DST rule;
 * other names (Outlook's "GMT Standard Time") use the file's VTIMEZONE; floating times and
 * all-day dates are read in the server's zone.
 */
function toInstant(time: ICAL.Time, reader: Reader): Date {
  if (time.zone === ICAL.Timezone.utcTimezone) {
    return new Date(time.toUnixTime() * 1000);
  }
  const clock: WallClock = {
    year: time.year,
    month: time.month,
    day: time.day,
    hour: time.isDate ? 0 : time.hour,
    minute: time.isDate ? 0 : time.minute,
  };
  const tzid = time.isDate ? undefined : zoneName(time);
  if (tzid && isIanaZone(tzid)) {
    return instantAt(clock, tzid);
  }
  const defined = tzid ? reader.zones.get(tzid) : undefined;
  if (defined) {
    const local = time.clone();
    local.zone = defined;
    return new Date(local.toUnixTime() * 1000);
  }
  return instantAt(clock, reader.floatingZone);
}

const ianaZones = new Map<string, boolean>();

function isIanaZone(name: string): boolean {
  let known = ianaZones.get(name);
  if (known === undefined) {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: name });
      known = true;
    } catch {
      known = false;
    }
    ianaZones.set(name, known);
  }
  return known;
}

/** A new single event, as the capture box makes it. */
export interface NewEvent {
  uid: string;
  title: string;
  start: Date;
  end: Date;
  timeZone: string;
  location?: string;
  /** A real place: written as its name and address, with coordinates for Apple's map. */
  place?: Place;
  notes?: string;
  url?: string;
  /** DTSTAMP and CREATED. */
  now: Date;
}

/** A VCALENDAR with one VEVENT and the VTIMEZONE it refers to. */
export function writeEvent(event: NewEvent): string {
  const calendar = new ICAL.Component(["vcalendar", [], []]);
  calendar.addPropertyWithValue("version", "2.0");
  calendar.addPropertyWithValue("prodid", "-//dashboardify//capture//EN");
  calendar.addSubcomponent(vtimezone(event.timeZone, event.start, event.end));

  const vevent = new ICAL.Component("vevent");
  vevent.addPropertyWithValue("uid", event.uid);
  vevent.addPropertyWithValue("dtstamp", ICAL.Time.fromJSDate(event.now, true));
  vevent.addPropertyWithValue("created", ICAL.Time.fromJSDate(event.now, true));
  vevent.addPropertyWithValue("summary", event.title);
  vevent.addProperty(zonedProperty("dtstart", event.start, event.timeZone));
  vevent.addProperty(zonedProperty("dtend", event.end, event.timeZone));
  if (event.place) {
    setPlace(vevent, event.place);
  }
  for (const [name, value] of [
    ["location", event.place ? undefined : event.location],
    ["description", event.notes],
    ["url", event.url],
  ] as const) {
    if (value) {
      vevent.addPropertyWithValue(name, value);
    }
  }
  calendar.addSubcomponent(vevent);
  return calendar.toString();
}

/** Fields UpdateEvent can change. An empty string clears a text field. */
export interface EventChange {
  title?: string;
  location?: string;
  /** A real place for the location; null clears it. Changing `location` alone drops it. */
  place?: Place | null;
  notes?: string;
  url?: string;
  start?: Date;
  end?: Date;
  /** Times are written in the event's own IANA zone, else this one. */
  timeZone: string;
  now: Date;
}

export class NotEditable extends Error {}

/**
 * Changes one single event in place, keeping everything else the server stored (alarms,
 * attendees, Apple's own properties). Bumps SEQUENCE and DTSTAMP. Recurring events and the
 * times of all-day events are refused.
 */
export function editEvent(ics: string, change: EventChange): string {
  const calendar = new ICAL.Component(ICAL.parse(ics));
  const vevents = calendar.getAllSubcomponents("vevent");
  const [vevent] = vevents;
  if (
    !vevent ||
    vevents.length > 1 ||
    vevent.hasProperty("rrule") ||
    vevent.hasProperty("recurrence-id")
  ) {
    throw new NotEditable(
      "Recurring events can't be changed here yet. Change it in Apple Calendar.",
    );
  }
  setText(vevent, "summary", change.title);
  if (change.location !== undefined || change.place !== undefined) {
    // The coordinates are of the old place: drop them with it.
    vevent.removeAllProperties("x-apple-structured-location");
    vevent.removeAllProperties("geo");
  }
  setText(vevent, "location", change.location);
  if (change.place) {
    setPlace(vevent, change.place);
  }
  setText(vevent, "description", change.notes);
  setText(vevent, "url", change.url);
  if (change.start || change.end) {
    setTimes(calendar, vevent, change);
  }
  vevent.updatePropertyWithValue("dtstamp", ICAL.Time.fromJSDate(change.now, true));
  vevent.updatePropertyWithValue("last-modified", ICAL.Time.fromJSDate(change.now, true));
  vevent.updatePropertyWithValue(
    "sequence",
    Number(vevent.getFirstPropertyValue("sequence") ?? 0) + 1,
  );
  return calendar.toString();
}

/**
 * LOCATION as Apple writes it (the name, then the address on the next line), plus GEO and
 * X-APPLE-STRUCTURED-LOCATION, which Apple Calendar uses for the map and travel time.
 */
function setPlace(vevent: ICAL.Component, place: Place): void {
  vevent.updatePropertyWithValue(
    "location",
    place.address ? `${place.name}\n${place.address}` : place.name,
  );
  // Parameter values can't hold a double quote.
  const name = place.name.replaceAll('"', "");
  const address = place.address.replaceAll('"', "");
  vevent.removeAllProperties("x-apple-structured-location");
  vevent.removeAllProperties("geo");
  const structured = new ICAL.Property("x-apple-structured-location");
  structured.resetType("uri");
  if (address) {
    structured.setParameter("x-address", address);
  }
  structured.setParameter("x-apple-radius", "70");
  structured.setParameter("x-title", name);
  structured.setValue(`geo:${place.latitude},${place.longitude}`);
  vevent.addProperty(structured);
  vevent.addPropertyWithValue("geo", [place.latitude, place.longitude]);
}

function setText(vevent: ICAL.Component, name: string, value: string | undefined): void {
  if (value === undefined) {
    return;
  }
  if (value === "") {
    vevent.removeAllProperties(name);
  } else {
    vevent.updatePropertyWithValue(name, value);
  }
}

function setTimes(calendar: ICAL.Component, vevent: ICAL.Component, change: EventChange): void {
  const event = new ICAL.Event(vevent);
  if (event.startDate.isDate) {
    throw new NotEditable("All-day events' dates can't be changed here yet.");
  }
  const own = zoneName(event.startDate);
  const zone = own && isIanaZone(own) ? own : change.timeZone;
  const zones = new Map<string, ICAL.Timezone>();
  for (const vtimezone of calendar.getAllSubcomponents("vtimezone")) {
    const defined = new ICAL.Timezone(vtimezone);
    zones.set(defined.tzid, defined);
  }
  const reader = { from: new Date(0), to: new Date(0), floatingZone: change.timeZone, zones };
  const start = change.start ?? toInstant(event.startDate, reader);
  const end = change.end ?? toInstant(event.endDate, reader);
  vevent.removeAllProperties("dtstart");
  vevent.removeAllProperties("dtend");
  vevent.removeAllProperties("duration");
  vevent.addProperty(zonedProperty("dtstart", start, zone));
  vevent.addProperty(zonedProperty("dtend", end, zone));
  if (!zones.has(zone)) {
    calendar.addSubcomponent(vtimezone(zone, start, end));
  }
}

function zonedProperty(name: string, at: Date, timeZone: string): ICAL.Property {
  const clock = wallClock(at, timeZone);
  const property = new ICAL.Property(name);
  property.setParameter("tzid", timeZone);
  property.setValue(
    new ICAL.Time({ ...clock, second: 0, isDate: false }, ICAL.Timezone.localTimezone),
  );
  return property;
}

/**
 * A VTIMEZONE for `timeZone` covering the event: the offset in force a year before it, then
 * every change up to a year after, each as its own observance. Built from Intl, so it matches
 * what the server uses to read the event back.
 */
function vtimezone(timeZone: string, start: Date, end: Date): ICAL.Component {
  const year = 365 * 86_400_000;
  const from = new Date(start.getTime() - year);
  const changes = offsetChanges(from, new Date(end.getTime() + year), timeZone);
  const offsets = [from, ...changes].map((at) => offsetMinutes(at, timeZone));
  // Daylight time is any offset above the zone's lowest one in the span.
  const standard = Math.min(...offsets);
  const component = new ICAL.Component("vtimezone");
  component.addPropertyWithValue("tzid", timeZone);
  [from, ...changes].forEach((at, i) => {
    const after = offsets[i] ?? standard;
    const before = offsets[i - 1] ?? after;
    component.addSubcomponent(observance(at, before, after, after > standard));
  });
  return component;
}

/** Each instant in [from, to) where the zone's offset changes, to the minute. */
function offsetChanges(from: Date, to: Date, timeZone: string): Date[] {
  const changes: Date[] = [];
  const day = 86_400_000;
  const offsetAt = (ms: number) => offsetMinutes(new Date(ms), timeZone);
  for (let t = from.getTime(); t < to.getTime(); t += day) {
    if (offsetAt(t) !== offsetAt(t + day)) {
      changes.push(new Date(firstChange(t, t + day, offsetAt)));
    }
  }
  return changes;
}

/** Binary search for the first minute in (low, high] with a different offset from `low`. */
function firstChange(low: number, high: number, offsetAt: (ms: number) => number): number {
  const before = offsetAt(low);
  let [lo, hi] = [low, high];
  while (hi - lo > 60_000) {
    const middle = Math.floor((lo + hi) / 120_000) * 60_000;
    if (offsetAt(middle) === before) {
      lo = middle;
    } else {
      hi = middle;
    }
  }
  return hi;
}

function observance(at: Date, before: number, after: number, daylight: boolean) {
  const component = new ICAL.Component(daylight ? "daylight" : "standard");
  // DTSTART is the local time as the clock read just before the change.
  const local = new Date(at.getTime() + before * 60_000);
  const start = new ICAL.Time(
    {
      year: local.getUTCFullYear(),
      month: local.getUTCMonth() + 1,
      day: local.getUTCDate(),
      hour: local.getUTCHours(),
      minute: local.getUTCMinutes(),
      second: 0,
      isDate: false,
    },
    ICAL.Timezone.localTimezone,
  );
  component.addPropertyWithValue("dtstart", start);
  component.addPropertyWithValue("tzoffsetfrom", utcOffset(before));
  component.addPropertyWithValue("tzoffsetto", utcOffset(after));
  return component;
}

function utcOffset(minutes: number): ICAL.UtcOffset {
  return ICAL.UtcOffset.fromSeconds(minutes * 60);
}
