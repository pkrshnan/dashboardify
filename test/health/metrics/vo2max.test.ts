import { describe, expect, test } from "bun:test";
import { vo2max } from "../../../src/health/metrics/vo2max";

const nights = (count: number, bpm: number | null): (number | null)[] =>
  Array.from({ length: count }, () => bpm);

describe("vo2max", () => {
  test("is 15.3 × max HR ÷ resting HR for a man", () => {
    const result = vo2max({ maxHrMeasured: 205, sex: "male", restingHrs: nights(30, 55) });

    // The user's own numbers: about 57.
    expect(result).toBeCloseTo((15.3 * 205) / 55, 6);
    expect(Math.round(result ?? 0)).toBe(57);
  });

  test("uses 14.5 for a woman", () => {
    expect(vo2max({ maxHrMeasured: 190, sex: "female", restingHrs: nights(30, 60) })).toBeCloseTo(
      (14.5 * 190) / 60,
      6,
    );
  });

  test("takes the median of the last 30 nights, skipping nights with no reading", () => {
    const restingHrs = [
      ...nights(10, 40),
      ...nights(9, 50),
      ...nights(10, null),
      ...nights(11, 70),
    ];

    // The last 30 hold 9 × 50 and 11 × 70: median 70. Counting the older 40s, or the gaps as
    // zeros, would give 50.
    expect(vo2max({ maxHrMeasured: 200, sex: "male", restingHrs })).toBeCloseTo(
      (15.3 * 200) / 70,
      6,
    );
  });

  test("needs 14 nights with a reading", () => {
    const thirteen = [...nights(17, null), ...nights(13, 55)];
    const fourteen = [...nights(16, null), ...nights(14, 55)];

    expect(vo2max({ maxHrMeasured: 205, sex: "male", restingHrs: thirteen })).toBeNull();
    expect(vo2max({ maxHrMeasured: 205, sex: "male", restingHrs: fourteen })).not.toBeNull();
  });

  test("needs a measured max HR and sex", () => {
    expect(vo2max({ maxHrMeasured: null, sex: "male", restingHrs: nights(30, 55) })).toBeNull();
    expect(vo2max({ maxHrMeasured: 205, sex: null, restingHrs: nights(30, 55) })).toBeNull();
  });

  test("a max at or below resting HR is a typo, not a number", () => {
    expect(vo2max({ maxHrMeasured: 55, sex: "male", restingHrs: nights(30, 55) })).toBeNull();
  });
});
