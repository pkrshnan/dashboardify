// Which reminders fall due between two moments, and what they say. Pure: the sender (scheduler.ts)
// passes the window, the events and tasks, and the settings, and keeps the log of what went.
// A reminder's key holds the thing's id and time, so a moved event or task gets new ones.

import { hhmm, instantAt, wallClock } from "../capture/zone";
import type { CalendarEvent } from "../home/calendar";
import type { FoundTask } from "../vault/task-store";
import type { PushMessage } from "./notifier";
import type { NotificationPrefs } from "./push-store";

const MINUTE_MS = 60_000;
/** A task reminder is kept this long for a phone that is offline. */
const TASK_TTL_S = 3600;

export interface Reminder {
  /** Stable across checks and restarts, for the sent log. */
  key: string;
  message: PushMessage;
  /** Seconds the push service may hold it. */
  ttl: number;
}

export interface Window {
  /** Exclusive, epoch ms: the last check, or no earlier than the late limit. */
  from: number;
  /** Inclusive: now. */
  to: number;
}

export function dueReminders(
  window: Window,
  inputs: {
    events: CalendarEvent[];
    tasks: FoundTask[];
    prefs: NotificationPrefs;
    timeZone: string;
  },
): Reminder[] {
  const { events, tasks, prefs, timeZone } = inputs;
  const fromEvents = events.flatMap((event) => {
    const reminder = eventReminder(event, prefs.eventOffsets, window, timeZone);
    return reminder ? [reminder] : [];
  });
  const fromTasks = prefs.taskReminders
    ? tasks.flatMap((found) => {
        const reminder = taskReminder(found, window, timeZone);
        return reminder ? [reminder] : [];
      })
    : [];
  return [...fromEvents, ...fromTasks];
}

/**
 * The nearest offset whose moment passed in the window, so an event added eight minutes before
 * it starts gets one reminder, not two. None once the event has started.
 */
function eventReminder(
  event: CalendarEvent,
  offsets: number[],
  window: Window,
  timeZone: string,
): Reminder | undefined {
  if (event.allDay || window.to >= event.start) {
    return undefined;
  }
  const passed = offsets.filter((minutes) => inWindow(event.start - minutes * MINUTE_MS, window));
  if (passed.length === 0) {
    return undefined;
  }
  const offset = Math.min(...passed);
  const id = event.event ?? `untitled/${event.title}`;
  const left = Math.ceil((event.start - window.to) / MINUTE_MS);
  const span = `${clock(event.start, timeZone)}–${clock(event.end, timeZone)}`;
  return {
    key: `event:${id}:${event.start}:${offset}`,
    message: {
      title: event.title || "Event",
      body: [inMinutes(left), span, event.detail].filter(Boolean).join(" · "),
      // The same tag for every offset, so the 10-minute reminder replaces the hour one.
      tag: `event:${id}:${event.start}`,
      url: event.event ? `/#/?event=${encodeURIComponent(event.event)}` : "/#/",
    },
    ttl: Math.ceil((event.start - window.to) / 1000),
  };
}

function taskReminder(found: FoundTask, window: Window, timeZone: string): Reminder | undefined {
  const { task, ref } = found;
  if (task.done || !(task.due && task.time)) {
    return undefined;
  }
  const at = dueInstant(task.due, task.time, timeZone);
  if (!inWindow(at, window)) {
    return undefined;
  }
  return {
    key: `task:${ref}:${task.due} ${task.time}`,
    message: {
      title: task.description,
      body: `Due ${task.time}`,
      tag: `task:${ref}`,
      url: "/#/lists/tasks",
    },
    ttl: TASK_TTL_S,
  };
}

function inWindow(at: number, window: Window): boolean {
  return at > window.from && at <= window.to;
}

function dueInstant(date: string, time: string, timeZone: string): number {
  const [year = 0, month = 1, day = 1] = date.split("-").map(Number);
  const [hour = 0, minute = 0] = time.split(":").map(Number);
  return instantAt({ year, month, day, hour, minute }, timeZone).getTime();
}

function clock(at: number, timeZone: string): string {
  const wall = wallClock(new Date(at), timeZone);
  return hhmm(wall.hour, wall.minute);
}

/** "In 10 min", "In 1 hour", "In 1 h 30 min". */
export function inMinutes(minutes: number): string {
  if (minutes < 60) {
    return `In ${minutes} min`;
  }
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (rest > 0) {
    return `In ${hours} h ${rest} min`;
  }
  return hours === 1 ? "In 1 hour" : `In ${hours} hours`;
}
