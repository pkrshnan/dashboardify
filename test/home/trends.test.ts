import { describe, expect, test } from "bun:test";
import { changeOf, duration, formatValue, type MetricDef, trend } from "../../src/home/trends";

const hrv: MetricDef = {
  key: "hrv",
  name: "HRV",
  unit: "ms",
  group: "heart",
  better: "up",
  format: "int",
};

/** 60 baseline days alternating base ± sd (so the SD is exactly sd), then 7 days at `recent`. */
function series(base: number, sd: number, recent: number): number[] {
  const baseline = Array.from({ length: 60 }, (_, i) => (i % 2 === 0 ? base + sd : base - sd));
  return [...baseline, ...Array(7).fill(recent)];
}

describe("changeOf", () => {
  test("compares the last 7 days with the 60 before them", () => {
    const change = changeOf(series(50, 5, 45));
    expect(change?.mean).toBeCloseTo(50);
    expect(change?.sd).toBeCloseTo(5);
    expect(change?.diff).toBeCloseTo(-5);
  });

  test("needs enough baseline days and enough recent days", () => {
    expect(changeOf(series(50, 5, 45).slice(-20))).toBeNull();
    const sparse: (number | null)[] = series(50, 5, 45);
    sparse.splice(-7, 7, 45, 45, null, null, null, null, null);
    expect(changeOf(sparse)).toBeNull();
  });
});

describe("trend", () => {
  test("a meaningful drop in HRV is a red percentage", () => {
    const t = trend(hrv, series(50, 5, 45), "2026-11-04");
    expect(t.value).toBe("45");
    expect(t.delta).toBe("−10%");
    expect(t.tone).toBe("bad");
    expect(t.baseline?.mean).toBeCloseTo(50);
  });

  test("a change under half an SD stays grey", () => {
    expect(trend(hrv, series(50, 5, 48), "2026-11-04").tone).toBe("neutral");
  });

  test("down is good for resting HR", () => {
    const rhr: MetricDef = { ...hrv, key: "rhr", better: "down" };
    expect(trend(rhr, series(50, 2, 47), "2026-11-04").tone).toBe("good");
  });

  test("metrics without a direction are always grey", () => {
    const strain: MetricDef = { ...hrv, better: undefined };
    expect(trend(strain, series(10, 1, 15), "2026-11-04").tone).toBe("neutral");
  });

  test("cumulative metrics show today's running total, with yesterday's next to it", () => {
    const steps: MetricDef = { ...hrv, format: "thousands", cumulative: true };
    const values = [...series(8000, 1000, 9840), 120];

    const t = trend(steps, values, "2026-11-04");

    expect(t.value).toBe("120");
    expect(t.yesterdayValue).toBe("9,840");
    expect(t.partial).toBe(true);
    expect(t.lastDate).toBe("2026-11-04");
    expect(t.values).toEqual(values);
  });

  test("today's running total never feeds the change", () => {
    const steps: MetricDef = { ...hrv, format: "thousands", cumulative: true };

    const t = trend(steps, [...series(8000, 1000, 9840), 120], "2026-11-04");

    // 9,840 against 8,000; counting the 120 would make it +5%.
    expect(t.delta).toBe("+23%");
  });

  test("snapshot metrics have no yesterday value", () => {
    const t = trend(hrv, series(50, 5, 45), "2026-11-04");
    expect(t.partial).toBe(false);
    expect(t.yesterdayValue).toBeNull();
  });

  test("skin temperature changes are shown in °C", () => {
    const skin: MetricDef = { ...hrv, unit: "°C", format: "dec1", absoluteDelta: true };
    expect(trend(skin, series(33.4, 0.3, 33.6), "2026-11-04").delta).toBe("+0.2 °C");
    expect(trend(skin, series(33.4, 0.3, 33.3), "2026-11-04").delta).toBe("−0.1 °C");
  });

  test("no data and no history", () => {
    const t = trend(hrv, [null, null], "2026-11-04");
    expect(t.value).toBeNull();
    expect(t.delta).toBeNull();
    expect(t.tone).toBe("neutral");
  });
});

describe("formatValue", () => {
  test("formats each kind of number", () => {
    expect(formatValue(61.6, "int")).toBe("62");
    expect(formatValue(11.44, "dec1")).toBe("11.4");
    expect(formatValue(9840.2, "thousands")).toBe("9,840");
    expect(formatValue(432, "duration")).toBe("7h 12m");
    expect(duration(425)).toBe("7h 05m");
  });
});
