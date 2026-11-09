import { describe, expect, test } from "bun:test";
import { MINUTE_MS } from "../../../src/health/metrics/types";
import { walks } from "../../../src/health/metrics/walks";
import { T0 } from "./fixtures";

/** Steps per minute from T0, one value per minute. */
function stepping(spm: number[]): Map<number, number> {
  return new Map(spm.map((count, i) => [T0 + i * MINUTE_MS, count]));
}

const repeat = (n: number, value: number) => Array.from({ length: n }, () => value);

describe("walks", () => {
  test("a steady walk with HR", () => {
    const steps = stepping(repeat(20, 110));
    const minutes = [...steps.keys()].map((ts) => ({ ts, bpm: 105 }));

    const [walk] = walks(steps, minutes, []);

    expect(walk).toMatchObject({ start: T0, minutes: 20, steps: 2200, cadence: 110, briskMin: 20 });
    expect(walk?.avgHr).toBe(105);
  });

  test("short stops don't end a walk, and their steps still count", () => {
    const steps = stepping([...repeat(8, 90), ...repeat(3, 10), ...repeat(8, 90)]);

    const found = walks(steps, [], []);

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ minutes: 19, steps: 1470, cadence: 90, briskMin: 0 });
    expect(found[0]?.avgHr).toBeNull();
  });

  test("a long stop splits a walk, and walks under 10 minutes don't count", () => {
    const steps = stepping([...repeat(12, 100), ...repeat(5, 0), ...repeat(6, 100)]);

    expect(walks(steps, [], []).map((w) => w.minutes)).toEqual([12]);
  });

  test("pottering about is not a walk", () => {
    expect(walks(stepping(repeat(30, 40)), [], [])).toEqual([]);
  });

  test("time in a workout is not a walk, and a walk doesn't join across one", () => {
    const steps = stepping(repeat(30, 110));
    const workout = { start: T0 + 10 * MINUTE_MS, end: T0 + 12 * MINUTE_MS };

    const found = walks(steps, [], [workout]);

    expect(found.map((w) => [w.start, w.minutes])).toEqual([
      [T0, 10],
      [T0 + 12 * MINUTE_MS, 18],
    ]);
  });
});
