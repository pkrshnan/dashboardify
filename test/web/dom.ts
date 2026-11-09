// A browser DOM for component tests, from happy-dom. It is registered only while a file that
// calls useDom() runs, since it replaces fetch, Request and Response, which the server tests need.

import { afterAll, afterEach, beforeAll } from "bun:test";
import { GlobalRegistrator } from "@happy-dom/global-registrator";
import { cleanup } from "@testing-library/preact";
import type { AgendaEvent, DayAgenda, Reminder } from "../../src/home/types";

export function useDom(): void {
  beforeAll(() => {
    GlobalRegistrator.register();
  });
  afterEach(() => {
    cleanup();
  });
  afterAll(async () => {
    await GlobalRegistrator.unregister();
  });
}

/** A timed event from minutes after midnight; its clock times are worked out from them. */
export function event(
  title: string,
  startMin: number,
  endMin: number,
  more: Partial<AgendaEvent> = {},
): AgendaEvent {
  return {
    title,
    start: clock(startMin),
    end: clock(endMin),
    startMin,
    endMin,
    detail: "",
    category: "work",
    url: null,
    mapsUrl: null,
    event: null,
    calendar: null,
    writable: false,
    allDay: false,
    ...more,
  };
}

export function allDay(title: string, more: Partial<AgendaEvent> = {}): AgendaEvent {
  return { ...event(title, 0, 24 * 60), start: "", end: "", allDay: true, ...more };
}

export function reminder(text: string, minutes: number, done = false): Reminder {
  return { id: text, text, time: clock(minutes), minutes, done };
}

export function day(date: string, items: Partial<DayAgenda> = {}): DayAgenda {
  return { date, events: [], reminders: [], dated: [], allDay: [], ...items };
}

function clock(min: number): string {
  return `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`;
}
