import { describe, expect, test } from "bun:test";
import type { Workout } from "../../src/health/metrics/workouts";
import { counted, reviewWorkouts } from "../../src/health/reviews";
import { T0 } from "./metrics/fixtures";

const MIN = 60_000;

const workout = (kind: Workout["kind"], startMin: number, minutes: number): Workout => ({
  start: T0 + startMin * MIN,
  end: T0 + (startMin + minutes) * MIN,
  kind,
  minutes,
  avgHr: 110,
  maxHr: 130,
  cadence: 0,
  trimp: 5,
  strain: 2,
  kcal: null,
});

const noLog = { session: null, logged: false };

describe("reviewed workouts", () => {
  test("lifting without a log, or an unknown kind, is possible; the rest are detected", () => {
    const found = reviewWorkouts(
      [workout("lifting", 0, 30), workout("workout", 60, 30), workout("volleyball", 120, 45)],
      [],
      noLog,
    );

    expect(found.map((w) => w.status)).toEqual(["possible", "possible", "detected"]);
  });

  test("the session the lifting log matched is confirmed lifting", () => {
    const [found] = reviewWorkouts([workout("workout", 0, 45)], [], {
      session: { start: T0, end: T0 + 45 * MIN },
      logged: true,
    });

    expect(found).toMatchObject({ kind: "lifting", status: "confirmed" });
  });

  test("a review decides, even if the workout was trimmed a little differently since", () => {
    const reviews = [
      { span: { start: T0 + 2 * MIN, end: T0 + 26 * MIN }, kind: "none" as const },
      { span: { start: T0 + 60 * MIN, end: T0 + 90 * MIN }, kind: "volleyball" as const },
    ];

    const found = reviewWorkouts(
      [workout("lifting", 0, 24), workout("workout", 60, 30), workout("running", 200, 30)],
      reviews,
      noLog,
    );

    expect(found.map((w) => [w.kind, w.status])).toEqual([
      ["lifting", "dismissed"],
      ["volleyball", "confirmed"],
      ["running", "detected"],
    ]);
    expect(counted(found)).toHaveLength(2);
  });

  test("a review that barely overlaps belongs to another workout", () => {
    const reviews = [{ span: { start: T0 + 20 * MIN, end: T0 + 60 * MIN }, kind: "none" as const }];

    const [found] = reviewWorkouts([workout("lifting", 0, 30)], reviews, noLog);

    expect(found?.status).toBe("possible");
  });
});
