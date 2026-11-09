import { describe, expect, test } from "bun:test";
import { buildDays, groupTasks, nextEvent } from "../../src/home/agenda";
import type { CalendarEvent } from "../../src/home/calendar";
import { daySentence } from "../../src/home/sentence";
import type { MetricTrend } from "../../src/home/types";
import type { FoundTask } from "../../src/vault/task-store";
import { parseTaskLine } from "../../src/vault/tasks";

const TZ = "Europe/London";
const TODAY = "2026-11-03";

function tasks(...lines: string[]): FoundTask[] {
  return lines.map((line, i) => {
    const task = parseTaskLine(line);
    if (!task) {
      throw new Error(`not a task: ${line}`);
    }
    return { ref: `t${i}`, path: "Inbox.md", task };
  });
}

const at = (date: string, time: string) =>
  Temporal.PlainDateTime.from(`${date}T${time}`).toZonedDateTime(TZ).epochMilliseconds;

function event(date: string, from: string, to: string, title: string): CalendarEvent {
  return { title, start: at(date, from), end: at(date, to), category: "work", detail: "Room 4B" };
}

describe("groupTasks", () => {
  const list = tasks(
    "- [ ] Renew lease 📅 2026-10-31",
    "- [ ] Upload receipt 📅 2026-11-03",
    "- [ ] Call Mum ⏰ 18:30 📅 2026-11-03",
    "- [ ] Prep notes ⏰ 15:00 📅 2026-11-06",
    "- [ ] Order lenses 📅 2026-11-05",
    "- [ ] Book flights 📅 2026-12-12",
    "- [ ] Fix bike brakes",
    "- [x] Already done 📅 2026-11-03",
  );

  test("puts each open task in one group, leaving today's timed ones for the timeline", () => {
    expect(groupTasks(list, TODAY)).toEqual([
      { name: "Overdue", tasks: [{ id: "t0", text: "Renew lease", meta: "3d late" }] },
      { name: "Today", tasks: [{ id: "t1", text: "Upload receipt", meta: "" }] },
      {
        name: "This week",
        tasks: [
          { id: "t4", text: "Order lenses", meta: "Thu" },
          { id: "t3", text: "Prep notes", meta: "Fri 15:00" },
        ],
      },
      { name: "Later", tasks: [{ id: "t5", text: "Book flights", meta: "12 Dec" }] },
      { name: "Someday", tasks: [{ id: "t6", text: "Fix bike brakes", meta: "" }] },
    ]);
  });

  test("leaves out empty groups", () => {
    expect(groupTasks(tasks("- [ ] Fix bike brakes"), TODAY).map((g) => g.name)).toEqual([
      "Someday",
    ]);
  });
});

describe("buildDays", () => {
  test("seven days, each with its events, reminders and dated tasks", () => {
    const days = buildDays(
      TODAY,
      TZ,
      [
        event(TODAY, "14:00", "15:00", "Design review"),
        event("2026-11-04", "10:00", "10:15", "Standup"),
      ],
      tasks(
        "- [x] Vitamin D ⏰ 09:00 📅 2026-11-03",
        "- [ ] Call Mum ⏰ 18:30 📅 2026-11-03",
        "- [ ] Upload receipt 📅 2026-11-03",
      ),
    );
    expect(days.map((d) => d.date)).toEqual([
      "2026-11-03",
      "2026-11-04",
      "2026-11-05",
      "2026-11-06",
      "2026-11-07",
      "2026-11-08",
      "2026-11-09",
    ]);
    const [today, tomorrow] = days;
    expect(today?.events).toEqual([
      {
        title: "Design review",
        start: "14:00",
        end: "15:00",
        startMin: 840,
        endMin: 900,
        detail: "Room 4B",
        category: "work",
        url: null,
        event: null,
        calendar: null,
        writable: false,
        allDay: false,
      },
    ]);
    expect(today?.reminders.map((r) => [r.text, r.minutes, r.done])).toEqual([
      ["Vitamin D", 540, true],
      ["Call Mum", 1110, false],
    ]);
    expect(today?.dated).toEqual(["Upload receipt"]);
    expect(tomorrow?.events.map((e) => e.title)).toEqual(["Standup"]);
  });

  test("an event across midnight shows on both days", () => {
    const late = {
      ...event(TODAY, "23:00", "23:30", "Late"),
      end: at("2026-11-04", "01:00"),
    };
    const [first, second] = buildDays(TODAY, TZ, [late], []);
    expect(first?.events[0]?.endMin).toBe(1500);
    expect(second?.events[0]?.startMin).toBe(0);
  });

  test("an all-day event is a Week marker on each of its days, never on the timeline", () => {
    const trip: CalendarEvent = {
      title: "Lisbon",
      start: at(TODAY, "00:00"),
      end: at("2026-11-05", "00:00"),
      category: "personal",
      allDay: true,
      startDate: TODAY,
      endDate: "2026-11-05",
    };

    const [first, second, third] = buildDays(TODAY, TZ, [trip], []);

    expect(first?.events).toEqual([]);
    expect(first?.allDay.map((e) => [e.title, e.allDay])).toEqual([["Lisbon", true]]);
    expect(second?.allDay.map((e) => e.title)).toEqual(["Lisbon"]);
    expect(third?.allDay).toEqual([]);
  });
});

describe("nextEvent", () => {
  const [today] = buildDays(TODAY, TZ, [event(TODAY, "10:00", "10:15", "Standup")], []);

  test("counts down to the next event, and says when it is on", () => {
    expect(nextEvent(today, 9 * 60 + 12)?.inMin).toBe(48);
    expect(nextEvent(today, 10 * 60 + 5)?.inMin).toBe(-5);
    expect(nextEvent(today, 11 * 60)).toBeNull();
  });
});

describe("daySentence", () => {
  const recovery = (raw: number, tone: MetricTrend["tone"]) =>
    ({ key: "recovery", raw, tone }) as MetricTrend;

  test("next event, a judgement on recovery, and at most one overdue mention", () => {
    const sentence = daySentence({
      next: { title: "Standup", start: "10:00", detail: "", inMin: 48, url: null },
      health: [recovery(62, "bad")],
      tasks: groupTasks(tasks("- [ ] Renew lease 📅 2026-10-31"), TODAY),
    });
    expect(sentence).toBe(
      "Standup at 10:00. Recovery is below your usual, so keep today easy. Renew lease is 3 days late.",
    );
  });

  test("several overdue tasks get one mention", () => {
    const sentence = daySentence({
      next: null,
      health: [recovery(70, "neutral")],
      tasks: groupTasks(
        tasks("- [ ] A 📅 2026-10-31", "- [ ] B 📅 2026-11-01", "- [ ] C 📅 2026-11-02"),
        TODAY,
      ),
    });
    expect(sentence).toBe("A and 2 more are overdue.");
  });

  test("says so when there is nothing to say", () => {
    expect(daySentence({ next: null, health: [], tasks: [] })).toBe("Nothing else on today.");
  });
});
