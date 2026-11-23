import { describe, expect, test } from "bun:test";
import type { CalendarEvent } from "../../src/home/calendar";
import { dueReminders, inMinutes } from "../../src/notifications/reminders";
import type { FoundTask } from "../../src/vault/task-store";

const ZONE = "Europe/London";
const at = (iso: string) => Date.parse(iso);
const prefs = { eventOffsets: [60, 10], taskReminders: true };

function event(overrides: Partial<CalendarEvent> = {}): CalendarEvent {
  return {
    title: "Standup",
    start: at("2026-11-23T10:00:00Z"),
    end: at("2026-11-23T10:30:00Z"),
    category: "work",
    event: "events/abc",
    ...overrides,
  } as CalendarEvent;
}

function task(overrides: Partial<FoundTask["task"]> = {}, ref = "k7f3a2"): FoundTask {
  return {
    ref,
    path: "Inbox.md",
    task: {
      done: false,
      description: "Call the bank",
      due: "2026-11-23",
      time: "09:00",
      ...overrides,
    },
  };
}

function due(from: string, to: string, inputs: { events?: CalendarEvent[]; tasks?: FoundTask[] }) {
  return dueReminders(
    { from: at(from), to: at(to) },
    { events: inputs.events ?? [], tasks: inputs.tasks ?? [], prefs, timeZone: ZONE },
  );
}

describe("event reminders", () => {
  test("an hour and ten minutes before, sharing a tag so the second replaces the first", () => {
    const hour = due("2026-11-23T08:59:30Z", "2026-11-23T09:00:00Z", { events: [event()] });
    const ten = due("2026-11-23T09:49:45Z", "2026-11-23T09:50:15Z", { events: [event()] });

    expect(hour).toEqual([
      {
        key: `event:events/abc:${at("2026-11-23T10:00:00Z")}:60`,
        message: {
          title: "Standup",
          body: "In 1 hour · 10:00–10:30",
          tag: `event:events/abc:${at("2026-11-23T10:00:00Z")}`,
          url: "/#/?event=events%2Fabc",
        },
        ttl: 3600,
      },
    ]);
    expect(ten[0]?.message.body).toBe("In 10 min · 10:00–10:30");
    expect(ten[0]?.key).toEndWith(":10");
    expect(ten[0]?.message.tag).toBe(hour[0]?.message.tag);
  });

  test("nothing between the offsets", () => {
    expect(due("2026-11-23T09:20:00Z", "2026-11-23T09:20:30Z", { events: [event()] })).toEqual([]);
  });

  test("late, it counts the minutes left", () => {
    const [late] = due("2026-11-23T09:45:00Z", "2026-11-23T09:54:00Z", { events: [event()] });

    expect(late?.message.body).toBe("In 6 min · 10:00–10:30");
    expect(late?.ttl).toBe(360);
  });

  test("two offsets passed together send only the nearer", () => {
    const reminders = due("2026-11-23T08:45:00Z", "2026-11-23T09:52:00Z", { events: [event()] });

    expect(reminders.map((r) => r.key)).toEqual([
      `event:events/abc:${at("2026-11-23T10:00:00Z")}:10`,
    ]);
  });

  test("none once the event has started, and none for all-day events", () => {
    const started = due("2026-11-23T09:45:00Z", "2026-11-23T10:00:00Z", { events: [event()] });
    const allDay = due("2026-11-22T22:00:00Z", "2026-11-23T00:00:00Z", {
      events: [event({ allDay: true, start: at("2026-11-23T00:00:00Z") })],
    });

    expect(started).toEqual([]);
    expect(allDay).toEqual([]);
  });

  test("a moved event gets a new key", () => {
    const moved = event({ start: at("2026-11-23T11:00:00Z"), end: at("2026-11-23T11:30:00Z") });

    const [first] = due("2026-11-23T08:59:30Z", "2026-11-23T09:00:00Z", { events: [event()] });
    const [second] = due("2026-11-23T09:59:30Z", "2026-11-23T10:00:00Z", { events: [moved] });

    expect(second?.key).not.toBe(first?.key);
  });

  test("the location goes after the times, which are in the server's zone", () => {
    const summer = event({
      start: at("2026-07-01T09:00:00Z"),
      end: at("2026-07-01T09:45:00Z"),
      detail: "Room 4",
    });

    const [reminder] = due("2026-07-01T08:49:30Z", "2026-07-01T08:50:00Z", { events: [summer] });

    expect(reminder?.message.body).toBe("In 10 min · 10:00–10:45 · Room 4");
  });

  test("no offsets, no event reminders", () => {
    const reminders = dueReminders(
      { from: at("2026-11-23T08:59:30Z"), to: at("2026-11-23T09:00:00Z") },
      { events: [event()], tasks: [], prefs: { ...prefs, eventOffsets: [] }, timeZone: ZONE },
    );

    expect(reminders).toEqual([]);
  });
});

describe("task reminders", () => {
  test("at the due time in the server's zone", () => {
    const summer = task({ due: "2026-07-01", time: "09:00" });

    const [reminder] = due("2026-07-01T07:59:30Z", "2026-07-01T08:00:00Z", { tasks: [summer] });

    expect(reminder).toEqual({
      key: "task:k7f3a2:2026-07-01 09:00",
      message: {
        title: "Call the bank",
        body: "Due 09:00",
        tag: "task:k7f3a2",
        url: "/#/lists/tasks",
      },
      ttl: 3600,
    });
  });

  test("none for done tasks, tasks with only a date, or before the time", () => {
    const reminders = due("2026-11-23T08:59:30Z", "2026-11-23T09:00:00Z", {
      tasks: [task({ done: true }), task({ time: undefined }), task({ time: "09:01" })],
    });

    expect(reminders).toEqual([]);
  });

  test("off in settings, none", () => {
    const reminders = dueReminders(
      { from: at("2026-11-23T08:59:30Z"), to: at("2026-11-23T09:00:00Z") },
      { events: [], tasks: [task()], prefs: { ...prefs, taskReminders: false }, timeZone: ZONE },
    );

    expect(reminders).toEqual([]);
  });

  test("a repeating task's next one has a new key", () => {
    const [today] = due("2026-11-23T08:59:30Z", "2026-11-23T09:00:00Z", { tasks: [task()] });
    const [tomorrow] = due("2026-11-24T08:59:30Z", "2026-11-24T09:00:00Z", {
      tasks: [task({ due: "2026-11-24" })],
    });

    expect(tomorrow?.key).not.toBe(today?.key);
  });
});

describe("inMinutes", () => {
  test("minutes, whole hours, and both", () => {
    expect([1, 10, 59, 60, 90, 120].map(inMinutes)).toEqual([
      "In 1 min",
      "In 10 min",
      "In 59 min",
      "In 1 hour",
      "In 1 h 30 min",
      "In 2 hours",
    ]);
  });
});
