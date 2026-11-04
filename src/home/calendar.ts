// Where the home screen gets calendar events from. The CalDAV and ICS reader is a later step
// (docs/plan.md, step 10); until it lands the server uses `noCalendar`, and the timeline shows
// only timed tasks.

import type { Category } from "./types";

export interface CalendarEvent {
  title: string;
  /** Epoch milliseconds, [start, end). */
  start: number;
  end: number;
  /** Location, people or notes, shown after the time. */
  detail?: string;
  category: Category;
  /** A video call or other link, for the Join button. */
  url?: string;
}

export interface CalendarSource {
  /** Timed events that overlap [from, to), in any order. */
  events(from: number, to: number): Promise<CalendarEvent[]>;
}

export const noCalendar: CalendarSource = {
  events: () => Promise.resolve([]),
};
