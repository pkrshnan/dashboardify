import { describe, expect, test } from "bun:test";
import type { DayTraceView } from "../../web/api";
import {
  bandPath,
  barPath,
  dayMinutes,
  latest,
  linePath,
  scale,
  stepsMax,
  tempRange,
  zoneOf,
  zonePaths,
} from "../../web/lib/day-trace";

const y = scale(0, 100, 100);

describe("zones", () => {
  test("by tenths of max HR from half of it, as zoneMinutes counts them", () => {
    expect([90, 100, 120, 140, 160, 180, 199].map((bpm) => zoneOf(bpm, 200))).toEqual([
      0, 1, 2, 3, 4, 5, 5,
    ]);
  });

  test("each segment is drawn in the zone of its midpoint", () => {
    const paths = zonePaths({ bucketMin: 1, values: [90, 92, null, 150, 150] }, 200, y);

    expect(paths).toEqual([
      { d: "M0.5 10L1.5 8", color: "#6E4A5C" },
      { d: "M3.5 -50L4.5 -50", color: "#FF7EB6" },
    ]);
  });

  test("without a max HR, one line in the heart colour", () => {
    const paths = zonePaths({ bucketMin: 1, values: [60, 70] }, null, y);

    expect(paths).toEqual([{ d: "M0.5 40L1.5 30", color: "#FF7EB6" }]);
  });
});

describe("paths", () => {
  test("a line breaks where a bucket is missing", () => {
    expect(linePath({ bucketMin: 1, values: [10, 20, null, 30] }, y)).toBe("M0.5 90L1.5 80M3.5 70");
  });

  test("the band runs along the highs and back along the lows, one shape per run", () => {
    const d = bandPath([10, 20, null, 5], [30, 40, null, 6], 1, y);

    expect(d).toBe("M0.5 70L1.5 60L1.5 80L0.5 90Z");
  });

  test("a bar per bucket with steps, none for a quiet or missing one", () => {
    const d = barPath({ bucketMin: 5, values: [50, 0, null, 100] }, y, 100);

    expect(d).toBe("M0.5 100h4V50h-4ZM15.5 100h4V0h-4Z");
  });
});

describe("scales", () => {
  test("skin temperature is padded to whole degrees and at least 4 °C tall", () => {
    expect(tempRange([33.2, 34.1, null])).toEqual({ lo: 32, hi: 36 });
    expect(tempRange([31.6, 35.8])).toEqual({ lo: 31, hi: 37 });
  });

  test("steps go to 600 a bucket unless the day beats it", () => {
    expect(stepsMax([120, null])).toBe(600);
    expect(stepsMax([640])).toBe(900);
  });
});

test("latest skips the missing buckets at the end", () => {
  expect(latest({ bucketMin: 1, values: [60, 64, null, null] })).toEqual({ index: 1, value: 64 });
  expect(latest({ bucketMin: 1, values: [null] })).toBeNull();
});

test("a 25-hour day keeps its extra hour", () => {
  const series = (n: number) => ({ bucketMin: 1, values: Array(n).fill(null) });
  const trace = (n: number) =>
    ({
      heartRate: { ...series(n), low: [], high: [] },
      steps: { bucketMin: 5, values: [] },
      skinTemp: series(n),
    }) as unknown as DayTraceView;

  expect(dayMinutes(trace(600))).toBe(1440);
  expect(dayMinutes(trace(1500))).toBe(1500);
});
