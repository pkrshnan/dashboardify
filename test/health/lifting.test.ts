import { describe, expect, test } from "bun:test";
import { liftingDay } from "../../src/health/lifting";
import type { Workout } from "../../src/health/metrics/workouts";
import { parseLiftingLog } from "../../src/vault/lifting";
import { heartRate, T0 } from "./metrics/fixtures";

const LOG = parseLiftingLog("## Workouts\n- Curl\n  - 20lbs, 1x10\n  - 10kg, 1x10\n");

const workout = (kind: Workout["kind"], minutes: number): Workout => ({
  start: T0,
  end: T0 + minutes * 60_000,
  kind,
  minutes,
  avgHr: 120,
  maxHr: 140,
  cadence: 0,
  trimp: 10,
  strain: 3,
});

/** Two climbs: 100 → 125 bpm at 1 and 4 minutes, back to 100 between. */
const twoSets = heartRate(T0, T0 + 6 * 60_000, (ts) => {
  const s = (ts - T0) / 1000;
  const bump = (at: number) => Math.max(0, 25 - Math.abs(s - at) / 2);
  return 100 + bump(60) + bump(240);
});

describe("lifting day", () => {
  test("joins the log to the lifting session and matches sets in order", () => {
    const day = liftingDay(LOG, [workout("volleyball", 60), workout("lifting", 6)], null, twoSets);

    expect(day?.found).toBe("workout");
    expect(day?.matched).toBe(true);
    expect(day?.sets.map((s) => Math.round(((s.climb?.peak ?? 0) - T0) / 60_000))).toEqual([1, 4]);
    // 20 lb × 10 + 10 kg × 10 in pounds.
    expect(day?.volumeLb).toBeCloseTo(200 + 220.46, 1);
  });

  test("without a lifting workout, moving in place is the session", () => {
    const day = liftingDay(
      LOG,
      [workout("running", 30)],
      { start: T0, end: T0 + 6 * 60_000 },
      twoSets,
    );

    expect(day).toMatchObject({ found: "movement", matched: true });
  });

  test("a log with no strap session is kept, unmatched", () => {
    const day = liftingDay(LOG, [workout("running", 30)], null, twoSets);

    expect(day).toMatchObject({ exercises: 1, session: null, found: null, matched: false });
    expect(day?.sets.every((s) => s.climb === null)).toBe(true);
  });

  test("no log, nothing to join", () => {
    expect(liftingDay([], [workout("lifting", 30)], null, twoSets)).toBeNull();
  });
});
