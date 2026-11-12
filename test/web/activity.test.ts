import { describe, expect, test } from "bun:test";
import {
  type ActivityDayView,
  calendarWeeks,
  distance,
  duration,
  heartRateLines,
  heartRateTicks,
  pace,
  rangeDates,
  totals,
  type WorkoutView,
  weeklyMinutes,
  workoutName,
} from "../../web/lib/activity";

const workout = (status: WorkoutView["status"], minutes: number): WorkoutView => ({
  name: "days/2026-11-08/workouts/1806",
  kind: "lifting",
  status,
  start: 0,
  end: minutes * 60_000,
  minutes,
  avgHr: 102,
  maxHr: 136,
  strain: 2.7,
});

const day = (date: string, workouts: WorkoutView[], walkMin = 0): ActivityDayView => ({
  date,
  steps: 5000,
  wornMin: 1400,
  workouts,
  walks: walkMin
    ? [{ start: 0, end: 0, minutes: walkMin, steps: 2000, cadence: 105, briskMin: 10 }]
    : [],
  lifting: null,
});

describe("activity page", () => {
  test("ranges end today: a week, 30 days, or the 13 weeks to this one", () => {
    expect(rangeDates("2026-11-08", "week")).toEqual({ start: "2026-11-02", end: "2026-11-08" });
    expect(rangeDates("2026-11-08", "month")).toEqual({ start: "2026-10-10", end: "2026-11-08" });
    // 8 Nov is a Sunday; its week starts Monday 2 Nov, and 12 weeks before that is 10 Aug.
    expect(rangeDates("2026-11-08", "3m")).toEqual({ start: "2026-08-10", end: "2026-11-08" });
  });

  test("totals leave out dismissed workouts and count the ones to confirm", () => {
    const t = totals([
      day("2026-11-04", [workout("dismissed", 24)]),
      day("2026-11-08", [workout("confirmed", 45), workout("possible", 20)], 41),
    ]);

    expect(t).toMatchObject({ workouts: 2, workoutMin: 65, toConfirm: 1, walks: 1, walkMin: 41 });
    expect(t.steps).toBe(10_000);
  });

  test("runs from Strava add up distance and pace; a dismissed one doesn't count", () => {
    const run = (status: WorkoutView["status"], minutes: number, meters: number): WorkoutView => ({
      ...workout(status, minutes),
      kind: "running",
      distanceMeters: meters,
      stravaActivityId: "1",
    });

    const t = totals([
      day("2026-11-09", [run("confirmed", 32, 5100), workout("confirmed", 45)]),
      day("2026-11-11", [run("confirmed", 28, 4900), run("dismissed", 10, 1000)]),
    ]);

    expect(t).toMatchObject({ runs: 2, runMeters: 10_000, runMin: 60 });
    expect(distance(t.runMeters)).toBe("10.0 km");
    expect(pace(t.runMin, t.runMeters)).toBe("6:00 /km");
    expect(pace(32, 5100)).toBe("6:16 /km");
  });

  test("the month calendar is Monday-first, with days outside the range left empty", () => {
    const weeks = calendarWeeks("2026-10-10", "2026-11-08");

    expect(weeks).toHaveLength(5);
    expect(weeks[0]).toEqual([null, null, null, null, null, "2026-10-10", "2026-10-11"]);
    expect(weeks[4]?.[6]).toBe("2026-11-08");
  });

  test("weekly minutes say which weeks had no strap data", () => {
    const weeks = weeklyMinutes(
      [day("2026-11-02", [workout("detected", 45)], 20)],
      "2026-10-26",
      "2026-11-08",
    );

    expect(weeks).toEqual([
      { start: "2026-10-26", workoutMin: 0, walkMin: 0, hasData: false },
      { start: "2026-11-02", workoutMin: 45, walkMin: 20, hasData: true },
    ]);
  });

  test("names and durations read as the design writes them", () => {
    expect(workoutName({ kind: "lifting", status: "possible" })).toBe("Lifting?");
    expect(workoutName({ kind: "volleyball", status: "confirmed" })).toBe("Volleyball");
    expect([duration(45), duration(65), duration(206)]).toEqual(["45m", "1h 05m", "3h 26m"]);
  });

  test("heart rate lines break where the strap had nothing", () => {
    const lines = heartRateLines(
      [100, 110, 0, 120, 0, 130, 140],
      0,
      (ms) => ms / 1000,
      (b) => b,
    );

    // The lone 120 between gaps can't make a line, so it is left out.
    expect(lines).toEqual(["7.5,100.0 22.5,110.0", "82.5,130.0 97.5,140.0"]);
  });

  test("heart rate ticks are round numbers inside the chart, wider apart on a tall chart", () => {
    expect(heartRateTicks(55, 125)).toEqual([60, 80, 100, 120]);
    expect(heartRateTicks(55, 105)).toEqual([60, 70, 80, 90, 100]);
    expect(heartRateTicks(60, 200)).toEqual([80, 120, 160]);
  });
});
