import { describe, expect, test } from "bun:test";
import { clip, heartRateSeries, notWorn, skinTempSeries, stepSeries } from "../../src/health/trace";

const START = Date.parse("2026-11-02T00:00:00Z");
const MIN = 60_000;
/** The first ten minutes of a day. */
const DAY = { start: START, end: START + 10 * MIN };

/** `count` samples a second apart from `from`. */
function seconds<T>(from: number, count: number, value: (i: number) => T) {
  return Array.from({ length: count }, (_, i) => ({ ts: from + i * 1000, ...value(i) }));
}

describe("heartRateSeries", () => {
  test("a minute is the mean of its seconds, with its lowest and highest", () => {
    const samples = seconds(START + MIN, 60, (i) => ({ bpm: i < 30 ? 60 : 80 }));

    const hr = heartRateSeries(samples, DAY);

    expect(hr.bucketMs).toBe(MIN);
    expect(hr.values).toHaveLength(10);
    expect(hr.values.slice(0, 3)).toEqual([null, 70, null]);
    expect(hr.low[1]).toBe(60);
    expect(hr.high[1]).toBe(80);
  });

  test("seconds of 0 bpm are no samples, so a mostly-off minute is missing", () => {
    const samples = seconds(START, 60, (i) => ({ bpm: i < 40 ? 0 : 90 }));

    expect(heartRateSeries(samples, DAY).values[0]).toBeNull();
  });

  test("samples outside the day are left out", () => {
    const samples = seconds(START - MIN, 60, () => ({ bpm: 70 }));

    expect(heartRateSeries(samples, DAY).values.every((v) => v === null)).toBe(true);
  });
});

describe("stepSeries", () => {
  test("steps are summed per 5 minutes; a quiet bucket is 0 and an empty one missing", () => {
    const counter = [
      { ts: START, count: 100 },
      { ts: START + MIN, count: 150 },
      { ts: START + 2 * MIN, count: 150 },
    ];
    const day = { start: START, end: START + 15 * MIN };

    const steps = stepSeries([...counter, { ts: START + 6 * MIN, count: 150 }], day);

    expect(steps.bucketMs).toBe(5 * MIN);
    expect(steps.values).toEqual([50, 0, null]);
  });

  test("a counter that wraps keeps counting", () => {
    const counter = [
      { ts: START, count: 65_500 },
      { ts: START + 30_000, count: 20 },
    ];

    expect(stepSeries(counter, DAY).values[0]).toBe(56);
  });
});

describe("skinTempSeries", () => {
  test("a minute is the mean of its readings, to 0.01 °C", () => {
    const samples = [
      { ts: START + 2 * MIN, celsius: 33.1 },
      { ts: START + 2 * MIN + 1000, celsius: 33.2 },
    ];

    const temps = skinTempSeries(samples, DAY);

    expect(temps.values[2]).toBe(33.15);
    expect(temps.values[3]).toBeNull();
  });
});

describe("notWorn", () => {
  test("off until on again, and an off before midnight counts from midnight", () => {
    const wear = [
      { ts: START - 3_600_000, on: false },
      { ts: START + 2 * MIN, on: true },
      { ts: START + 5 * MIN, on: false },
    ];

    expect(notWorn(wear, DAY)).toEqual([
      { start: START, end: START + 2 * MIN },
      { start: START + 5 * MIN, end: DAY.end },
    ]);
  });

  test("a repeated off doesn't restart the span", () => {
    const wear = [
      { ts: START + MIN, on: false },
      { ts: START + 2 * MIN, on: false },
      { ts: START + 3 * MIN, on: true },
    ];

    expect(notWorn(wear, DAY)).toEqual([{ start: START + MIN, end: START + 3 * MIN }]);
  });
});

describe("clip", () => {
  test("cuts spans to the day and drops those outside it", () => {
    const spans = [
      { start: START - MIN, end: START + MIN, kind: "sleep" },
      { start: DAY.end + MIN, end: DAY.end + 2 * MIN, kind: "walk" },
    ];

    expect(clip(spans, DAY)).toEqual([{ start: START, end: START + MIN, kind: "sleep" }]);
  });
});
