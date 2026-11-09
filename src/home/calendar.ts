// Where the home screen gets calendar events from: the sync cache (src/calendar/source.ts), or
// `noCalendar` when no account is connected, as in the demo and tests.

import type { Category } from "./types";

export interface CalendarEvent {
  title: string;
  /** Epoch milliseconds, [start, end). For all-day events, local midnights. */
  start: number;
  end: number;
  /** Location, people or notes, shown after the time. */
  detail?: string;
  category: Category;
  /** A video call or other link, for the Join button. */
  url?: string;
  /** An Apple Maps link to the location, when it has coordinates. */
  mapsUrl?: string;
  /** `events/{id}`, for opening and editing; absent for events with no source resource. */
  event?: string;
  /** `calendarAccounts/{a}/calendars/{c}`. */
  calendar?: string;
  /** Whether it can be edited here. */
  writable?: boolean;
  /** All-day: shown as a Week marker on each day from startDate up to (not including) endDate. */
  allDay?: boolean;
  startDate?: string;
  endDate?: string;
}

/** When calendars last synced, for "Calendar synced 09:10". */
export interface CalendarStatus {
  /** The oldest last successful check of the server across accounts, ISO. */
  lastSyncTime?: string;
  /** Any account signed out or unreachable. */
  hasErrors: boolean;
}

export interface CaptureHints {
  calendars: { name: string; displayName: string; category: Category }[];
  defaultCalendar?: string;
  rules: { words: string[]; calendar: string }[];
  titles: { titleKey: string; calendar: string; count: number; lastTime: string }[];
}

export interface CalendarSource {
  /** Events that overlap [from, to), in any order. */
  events(from: number, to: number): Promise<CalendarEvent[]>;
  /** Undefined when no account is connected. */
  status?(): CalendarStatus | undefined;
  /** What the capture box needs to guess a calendar; undefined with nothing writable. */
  hints?(now: number): CaptureHints | undefined;
}

export const noCalendar: CalendarSource = {
  events: () => Promise.resolve([]),
};
