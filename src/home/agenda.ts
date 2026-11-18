// Calendar events and tasks, sorted into the home screen's places. Each item has one home
// (docs/design/README.md): anything with a time today is on the timeline only, and anything
// without a time is in the task list only.

import type { FoundTask } from "../vault/task-store";
import type { CalendarEvent } from "./calendar";
import type {
  AgendaEvent,
  DayAgenda,
  NextEvent,
  TaskGroup,
  TaskGroupName,
  TaskItem,
} from "./types";

const DAY_MIN = 1440;
export const WEEK_DAYS = 7;

/** Seven days from `today`, each with its events, timed tasks and dated tasks. */
export function buildDays(
  today: string,
  timeZone: string,
  calendarEvents: CalendarEvent[],
  tasks: FoundTask[],
): DayAgenda[] {
  const events = calendarEvents.map((e) => wholeDays(e, timeZone));
  const start = Temporal.PlainDate.from(today);
  return Array.from({ length: WEEK_DAYS }, (_, i) => {
    const date = start.add({ days: i });
    const midnight = date.toZonedDateTime(timeZone).epochMilliseconds;
    const iso = date.toString();
    const dated = tasks.filter((t) => t.task.due === iso && !t.task.time);
    return {
      date: iso,
      events: eventsOn(events, midnight, timeZone),
      reminders: tasks
        .filter((t) => t.task.due === iso && t.task.time)
        .map((t) => ({
          id: t.ref,
          text: t.task.description,
          time: t.task.time ?? "",
          minutes: clockMinutes(t.task.time ?? "00:00"),
          done: t.task.done,
        }))
        .sort((a, b) => a.minutes - b.minutes),
      dated: dated.filter((t) => !t.task.done).map((t) => t.task.description),
      datedDone: dated.filter((t) => t.task.done).map((t) => t.task.description),
      allDay: events
        .filter(
          (e) => e.allDay && e.startDate && e.endDate && e.startDate <= iso && iso < e.endDate,
        )
        .map((e) => agendaEvent(e, midnight, timeZone)),
    };
  });
}

/**
 * A timed event from one local midnight to another as an all-day one. Free/busy feeds such as
 * Google's send an all-day "Busy" block this way, which would otherwise fill the timeline and be
 * "on now" all day.
 */
function wholeDays(e: CalendarEvent, timeZone: string): CalendarEvent {
  if (e.allDay) {
    return e;
  }
  const start = Temporal.Instant.fromEpochMilliseconds(e.start).toZonedDateTimeISO(timeZone);
  const end = Temporal.Instant.fromEpochMilliseconds(e.end).toZonedDateTimeISO(timeZone);
  const midnight = (t: Temporal.ZonedDateTime) => t.equals(t.startOfDay());
  if (e.end <= e.start || !midnight(start) || !midnight(end)) {
    return e;
  }
  return {
    ...e,
    allDay: true,
    startDate: start.toPlainDate().toString(),
    endDate: end.toPlainDate().toString(),
  };
}

function eventsOn(events: CalendarEvent[], midnight: number, timeZone: string): AgendaEvent[] {
  const nextMidnight = midnight + DAY_MIN * 60_000;
  return events
    .filter((e) => !e.allDay && e.start < nextMidnight && e.end > midnight)
    .sort((a, b) => a.start - b.start)
    .map((e) => agendaEvent(e, midnight, timeZone));
}

function agendaEvent(e: CalendarEvent, midnight: number, timeZone: string): AgendaEvent {
  return {
    title: e.title,
    start: clock(e.start, timeZone),
    end: clock(e.end, timeZone),
    startMin: Math.max(0, Math.round((e.start - midnight) / 60_000)),
    endMin: Math.round((e.end - midnight) / 60_000),
    detail: e.detail ?? "",
    category: e.category,
    url: e.url ?? null,
    mapsUrl: e.mapsUrl ?? null,
    event: e.event ?? null,
    calendar: e.calendar ?? null,
    calendarName: e.calendarName,
    writable: e.writable ?? false,
    allDay: e.allDay ?? false,
  };
}

/** The event on now, or else the next one today. */
export function nextEvent(today: DayAgenda | undefined, nowMin: number): NextEvent | null {
  const event = today?.events.find((e) => e.endMin > nowMin);
  if (!event) {
    return null;
  }
  return {
    title: event.title,
    start: event.start,
    detail: event.detail,
    inMin: event.startMin - nowMin,
    url: event.url,
    mapsUrl: event.mapsUrl,
    calendarName: event.calendarName,
  };
}

/** Open tasks for the task list, leaving out today's timed ones (they're on the timeline). */
export function groupTasks(tasks: FoundTask[], today: string): TaskGroup[] {
  const groups = new Map<TaskGroupName, { sortKey: string; item: TaskItem }[]>();
  for (const t of tasks) {
    const name = groupOf(t, today);
    if (t.task.done || name === null) {
      continue;
    }
    const entries = groups.get(name) ?? [];
    entries.push({ sortKey: sortKey(t), item: toItem(t, name, today) });
    groups.set(name, entries);
  }
  const order: TaskGroupName[] = ["Overdue", "Today", "This week", "Later", "Someday"];
  return order
    .filter((name) => groups.has(name))
    .map((name) => ({
      name,
      tasks: (groups.get(name) ?? [])
        .sort((a, b) => a.sortKey.localeCompare(b.sortKey))
        .map((e) => e.item),
    }));
}

function groupOf(t: FoundTask, today: string): TaskGroupName | null {
  const { due, time } = t.task;
  if (!due) {
    return "Someday";
  }
  if (due < today) {
    return "Overdue";
  }
  if (due === today) {
    return time ? null : "Today";
  }
  return daysBetween(today, due) < WEEK_DAYS ? "This week" : "Later";
}

function toItem(t: FoundTask, group: TaskGroupName, today: string): TaskItem {
  return { id: t.ref, text: t.task.description, meta: metaOf(t, group, today) };
}

function metaOf(t: FoundTask, group: TaskGroupName, today: string): string {
  const { due, time } = t.task;
  if (!due || group === "Today") {
    return "";
  }
  if (group === "Overdue") {
    return `${daysBetween(due, today)}d late`;
  }
  const day = Temporal.PlainDate.from(due);
  const label =
    group === "This week"
      ? day.toLocaleString("en-GB", { weekday: "short" })
      : day.toLocaleString("en-GB", { day: "numeric", month: "short" });
  return time ? `${label} ${time}` : label;
}

function sortKey(t: FoundTask): string {
  return `${t.task.due ?? "9999-99-99"} ${t.task.time ?? "99:99"} ${t.task.description}`;
}

export function daysBetween(from: string, to: string): number {
  return Temporal.PlainDate.from(from).until(to, { largestUnit: "days" }).days;
}

/** "HH:MM" as minutes after midnight. */
export function clockMinutes(time: string): number {
  const [h, m] = time.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

function clock(ts: number, timeZone: string): string {
  return Temporal.Instant.fromEpochMilliseconds(ts)
    .toZonedDateTimeISO(timeZone)
    .toPlainTime()
    .toString({ smallestUnit: "minute" });
}
