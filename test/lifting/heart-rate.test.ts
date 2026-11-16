import { describe, expect, test } from "bun:test";
import type { DerivedRow } from "../../src/health/derived-store";
import { sessionHeartRate } from "../../src/lifting/heart-rate";

const MIN = 60_000;

function set(
  exercise: string,
  startMin: number,
  peakHr: number | null,
  warmUp = false,
): DerivedRow {
  const start = Date.UTC(2026, 10, 8, 18) + startMin * MIN;
  return {
    exercise,
    warm_up: warmUp ? 1 : 0,
    start_ts: peakHr === null ? null : start,
    peak_ts: peakHr === null ? null : start + MIN,
    peak_hr: peakHr,
  };
}

describe("session heart rate", () => {
  test("rest is the median gap between sets; peak averages the working sets", () => {
    const rows = [
      set("Chest Press", 0, 120, true),
      set("Chest Press", 3, 140),
      set("Chest Press", 6, 142),
      set("Chest Press", 10, 144),
      set("Cable Fly Crossovers", 14, 130),
    ];

    expect(sessionHeartRate(rows, "chest press")).toEqual({ restSeconds: 120, peakHr: 142 });
  });

  test("rest runs from a set's end when motion gave one, not from its peak", () => {
    // Each set ends 40 s after it starts, and peaks 20 s after that.
    const rows = [0, 3, 6].map((m) => ({
      ...set("Leg Press", m, 150),
      end_ts: Date.UTC(2026, 10, 8, 18) + m * MIN + 40_000,
    }));

    expect(sessionHeartRate(rows, "leg press")?.restSeconds).toBe(140);
  });

  test("matches the exercise by its key, so a plural spelling still counts", () => {
    const rows = [set("Cable Fly Crossovers", 0, 130), set("Cable Fly Crossovers", 3, 134)];

    expect(sessionHeartRate(rows, "cable fly crossover")).toEqual({
      restSeconds: 120,
      peakHr: 132,
    });
  });

  test("a day whose sets weren't matched has no heart rate", () => {
    const rows = [set("Chest Press", 0, null), set("Chest Press", 3, null)];

    expect(sessionHeartRate(rows, "chest press")).toBeNull();
  });

  test("one matched set has a peak but no rest", () => {
    expect(sessionHeartRate([set("Leg Press", 0, 150)], "leg press")).toEqual({
      restSeconds: null,
      peakHr: 150,
    });
  });
});
