import { describe, expect, test } from "bun:test";
import {
  cadenceNote,
  type FactView,
  gridStart,
  gridWeeks,
  type HabitDayView,
  type HabitView,
  monthLabels,
  progressNote,
  ruleLabel,
  ruleParts,
  ruleText,
  scheduleLabel,
  weekDots,
  withTick,
} from "../../web/lib/habits";

// Thursday 12 Nov 2026.
const TODAY = "2026-11-12";

const FACTS: FactView[] = [
  { name: "steps", label: "Steps", kind: "count", night: false, defaultRule: "steps ≥ 8000" },
  { name: "lifting", label: "Lifting", kind: "count", night: false, defaultRule: "lifting ≥ 1" },
  {
    name: "lights_out",
    label: "Lights out",
    kind: "time",
    night: true,
    defaultRule: "lights_out ≤ 23:30",
  },
];

const day = (date: string, mark: HabitDayView["mark"], scheduled = true): HabitDayView => ({
  date,
  mark,
  scheduled,
  ticked: false,
});

const habit = (over: Partial<HabitView> = {}): HabitView => ({
  name: "habits/read",
  id: "read",
  displayName: "Read",
  schedule: { kind: "daily", times: 3, days: [] },
  auto: "",
  color: "#FF7EB6",
  state: "active",
  startDate: "2026-09-01",
  progress: {
    day: TODAY,
    streak: 4,
    unit: "day",
    atRisk: false,
    recentDone: 26,
    recentOf: 30,
    thisWeek: 2,
    due: true,
    done: false,
  },
  etag: "e",
  ...over,
});

describe("the grid", () => {
  test("columns run Monday to Sunday, the last one this week", () => {
    const weeks = gridWeeks([], TODAY, 2);

    expect(weeks.map((w) => [w[0]?.date, w[6]?.date])).toEqual([
      ["2026-11-02", "2026-11-08"],
      ["2026-11-09", "2026-11-15"],
    ]);
    expect(gridStart(TODAY, 2)).toBe("2026-11-02");
  });

  test("each square says how its day went; days to come are empty and can't be ticked", () => {
    const days = [
      day("2026-11-09", "done"),
      day("2026-11-10", "open"),
      day("2026-11-11", "open", false),
      day(TODAY, "pending"),
      day("2026-11-08", "before"),
    ];

    const week = gridWeeks(days, TODAY, 2)[1] ?? [];

    expect(week.map((c) => c.state)).toEqual([
      "done",
      "missed",
      "off",
      "pending",
      "empty",
      "empty",
      "empty",
    ]);
    expect(week.map((c) => c.isToday)).toEqual([false, false, false, true, false, false, false]);
    expect(week.map((c) => c.canTick)).toEqual([true, true, true, true, false, false, false]);
    expect(gridWeeks(days, TODAY, 2)[0]?.[6]?.state).toBe("empty");
  });

  test("names a month over the column with its first Monday", () => {
    expect(monthLabels(gridWeeks([], TODAY, 3))).toEqual(["", "Nov", ""]);
  });

  test("a tick shows before the server answers", () => {
    const days = [day("2026-11-10", "open")];

    expect(withTick(days, "2026-11-10", true)[0]).toMatchObject({ mark: "done", ticked: true });
    expect(withTick(days, TODAY, true).map((d) => d.date)).toEqual(["2026-11-10", TODAY]);
  });
});

describe("labels", () => {
  test("schedules read as the design writes them", () => {
    expect(scheduleLabel({ kind: "daily", times: 3, days: [] })).toBe("Every day");
    expect(scheduleLabel({ kind: "weekly", times: 3, days: [] })).toBe("3× a week");
    expect(scheduleLabel({ kind: "days", times: 3, days: [7, 1, 2, 3, 4] })).toBe("Sun–Thu");
    expect(scheduleLabel({ kind: "days", times: 3, days: [1, 3, 5] })).toBe("Mon Wed Fri");
    expect(scheduleLabel({ kind: "days", times: 3, days: [1, 2, 3, 4, 5, 6, 7] })).toBe(
      "Every day",
    );
  });

  test("what ticks it reads plainly", () => {
    expect(ruleLabel("steps ≥ 8000", FACTS)).toBe("Steps 8,000+");
    expect(ruleLabel("lifting", FACTS)).toBe("Lifting");
    expect(ruleLabel("lights_out ≤ 23:30", FACTS)).toBe("by 23:30");
    expect(ruleLabel("", FACTS)).toBe("");
  });

  test("the note under the streak: the recent count, or what's at risk", () => {
    const atRisk = { ...habit().progress, atRisk: true };

    expect(progressNote(habit(), FACTS)).toBe("26 of 30, last 30 days");
    expect(progressNote(habit({ progress: atRisk }), FACTS)).toBe("Missed yesterday · tick today");
    expect(progressNote(habit({ auto: "lights_out ≤ 23:30", progress: atRisk }), FACTS)).toBe(
      "Missed last night · tonight keeps it",
    );
  });

  test("a weekly habit shows this week as dots", () => {
    const lift = habit({ schedule: { kind: "weekly", times: 3, days: [] } });

    expect(weekDots(lift)).toEqual([true, true, false]);
    expect(weekDots(habit())).toEqual([]);
  });

  test("says how the streak counts for each cadence", () => {
    expect(cadenceNote({ kind: "weekly", times: 3, days: [] })).toBe(
      "Any 3 days, Monday to Sunday. The streak counts weeks.",
    );
    expect(cadenceNote({ kind: "daily", times: 3, days: [] })).toContain("Two in a row");
  });
});

describe("rules in the form", () => {
  test("splits a rule into the fact and its value, a bare fact taking its default", () => {
    expect(ruleParts("steps ≥ 10000", FACTS)).toEqual({ fact: "steps", value: "10000" });
    expect(ruleParts("lifting", FACTS)).toEqual({ fact: "lifting", value: "1" });
    expect(ruleParts("bogus ≥ 2", FACTS)).toEqual({ fact: "", value: "" });
  });

  test("writes it back: a time is a deadline, the rest a minimum", () => {
    expect(ruleText({ fact: "steps", value: "9000" }, FACTS)).toBe("steps ≥ 9000");
    expect(ruleText({ fact: "lights_out", value: "23:00" }, FACTS)).toBe("lights_out ≤ 23:00");
    expect(ruleText({ fact: "steps", value: " " }, FACTS)).toBe("steps ≥ 8000");
    expect(ruleText({ fact: "", value: "" }, FACTS)).toBe("");
  });
});
