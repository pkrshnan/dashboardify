import { describe, expect, test } from "bun:test";
import { datesBetween } from "../../src/habits/habit-day";
import type { Habit, Schedule } from "../../src/habits/habit-note";
import { type DayMark, habitStats, isScheduled } from "../../src/habits/streaks";

// Thursday 12 Nov 2026.
const TODAY = "2026-11-12";

const habit = (schedule: Schedule): Habit => ({
  id: "h",
  name: "H",
  schedule,
  auto: null,
  color: null,
  since: null,
  state: "active",
  extra: [],
  line: 0,
});
const daily = habit({ kind: "daily" });
const weekly = (times: number) => habit({ kind: "weekly", times });

/** Done on the dates given, pending on `pending`, open otherwise. */
const stats = (h: Habit, done: string[], start = "2026-09-01", pending: string[] = []) =>
  habitStats(h, {
    start,
    today: TODAY,
    mark: (date): DayMark => {
      if (pending.includes(date)) {
        return "pending";
      }
      return done.includes(date) ? "done" : "open";
    },
  });

describe("daily streaks", () => {
  test("counts days done back from yesterday while today is still open", () => {
    const s = stats(daily, datesBetween("2026-11-06", "2026-11-11"));

    expect(s).toMatchObject({ streak: 6, unit: "day", atRisk: false, dueToday: true });
    expect(s.doneToday).toBe(false);
  });

  test("forgives one missed day but not two in a row", () => {
    const oneMiss = [
      ...datesBetween("2026-11-01", "2026-11-05"),
      ...datesBetween("2026-11-07", TODAY),
    ];
    const twoMisses = [
      ...datesBetween("2026-11-01", "2026-11-04"),
      ...datesBetween("2026-11-07", TODAY),
    ];

    expect(stats(daily, oneMiss).streak).toBe(11);
    expect(stats(daily, twoMisses).streak).toBe(6);
  });

  test("is at risk when yesterday was missed and today isn't done", () => {
    const upToTenth = datesBetween("2026-11-01", "2026-11-10");

    expect(stats(daily, upToTenth)).toMatchObject({ streak: 10, atRisk: true });
    expect(stats(daily, [...upToTenth, TODAY])).toMatchObject({ streak: 11, atRisk: false });
  });

  test("pending days neither count nor break, and a pending today can still be at risk", () => {
    const done = ["2026-11-08", "2026-11-09", "2026-11-11"];

    expect(stats(daily, done, "2026-11-08", ["2026-11-10"]).streak).toBe(3);
    expect(stats(daily, ["2026-11-10"], "2026-11-08", [TODAY])).toMatchObject({
      streak: 1,
      atRisk: true,
    });
  });

  test("counts the last 30 days, skipping today until it's done and days before the start", () => {
    expect(stats(daily, ["2026-11-10", "2026-11-11"], "2026-11-10").recent).toEqual({
      done: 2,
      of: 2,
    });
    expect(stats(daily, datesBetween("2026-10-14", TODAY)).recent).toEqual({ done: 30, of: 30 });
    expect(stats(daily, []).recent).toEqual({ done: 0, of: 29 });
  });
});

describe("weekday streaks", () => {
  const monWedFri = habit({ kind: "days", days: [1, 3, 5] });

  test("only scheduled days count, so days off never break it", () => {
    const s = stats(monWedFri, [
      "2026-11-02",
      "2026-11-04",
      "2026-11-06",
      "2026-11-09",
      "2026-11-11",
    ]);

    expect(s).toMatchObject({ streak: 5, dueToday: false, atRisk: false });
    expect(s.recent.of).toBe(13);
  });

  test("knows which days are scheduled", () => {
    expect(isScheduled(monWedFri.schedule, "2026-11-09")).toBe(true);
    expect(isScheduled(monWedFri.schedule, TODAY)).toBe(false);
    expect(isScheduled(daily.schedule, TODAY)).toBe(true);
  });
});

describe("weekly streaks", () => {
  // Met in the weeks of 12 Oct, 26 Oct and 2 Nov; one day in the week of 19 Oct.
  const done = [
    ...["2026-10-12", "2026-10-14", "2026-10-16", "2026-10-20"],
    ...["2026-10-26", "2026-10-28", "2026-10-30", "2026-11-02", "2026-11-04", "2026-11-06"],
    ...["2026-11-09", "2026-11-11"],
  ];

  test("counts weeks met; this week counts once met and doesn't break it before", () => {
    expect(stats(weekly(3), done)).toMatchObject({
      streak: 2,
      unit: "week",
      thisWeek: 2,
      dueToday: true,
      recent: { done: 3, of: 4 },
    });
    expect(stats(weekly(3), [...done, TODAY])).toMatchObject({
      streak: 3,
      thisWeek: 3,
      dueToday: false,
      recent: { done: 4, of: 5 },
    });
  });

  test("is at risk once every day left this week is needed", () => {
    const lastWeek = datesBetween("2026-11-02", "2026-11-06");

    expect(stats(weekly(5), [...lastWeek, "2026-11-09"]).atRisk).toBe(true);
    expect(stats(weekly(4), [...lastWeek, "2026-11-09"]).atRisk).toBe(false);
  });

  test("a week before the habit started isn't a miss", () => {
    expect(stats(weekly(2), ["2026-11-09", "2026-11-10"], "2026-11-09").recent).toEqual({
      done: 1,
      of: 1,
    });
  });
});
