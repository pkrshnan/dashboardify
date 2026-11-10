import { describe, expect, test } from "bun:test";
import {
  type Body,
  bmr,
  dayCalories,
  keytelKcal,
  minuteKcal,
} from "../../../src/health/metrics/calories";
import { minuteHr } from "../../../src/health/metrics/heart-rate";
import { dayMetrics } from "../../../src/health/metrics/summary";
import { HOUR, heartRate, T0 } from "./fixtures";

const MAN: Body = { weightKg: 75, heightCm: 180, ageYears: 30, sex: "male" };
const WOMAN: Body = { weightKg: 60, heightCm: 165, ageYears: 30, sex: "female" };
// Flex point: 55 + 0.4 × (190 − 55) = 109 bpm.
const HR = { restingHr: 55, maxHr: 190 };
const PER_MIN = 1730 / 1440;

describe("bmr", () => {
  test("Mifflin–St Jeor for a known man and woman", () => {
    // 10 × 75 + 6.25 × 180 − 5 × 30 + 5, and 10 × 60 + 6.25 × 165 − 5 × 30 − 161.
    expect(bmr(MAN)).toBe(1730);
    expect(bmr(WOMAN)).toBe(1320.25);
  });
});

describe("minuteKcal", () => {
  test("asleep is BMR × 0.95 whatever the heart rate", () => {
    expect(minuteKcal(140, true, { ...HR, body: MAN })).toBeCloseTo(PER_MIN * 0.95, 9);
  });

  test("awake with no heart rate is BMR × 1.2", () => {
    expect(minuteKcal(null, false, { ...HR, body: MAN })).toBeCloseTo(PER_MIN * 1.2, 9);
  });

  test("Keytel takes over only above the flex point", () => {
    expect(minuteKcal(109, false, { ...HR, body: MAN })).toBeCloseTo(PER_MIN * 1.2, 9);
    // (−55.0969 + 0.6309 × 110 + 0.1988 × 75 + 0.2017 × 30) kJ ÷ 4.184.
    expect(minuteKcal(110, false, { ...HR, body: MAN })).toBeCloseTo(8.428, 3);
    expect(keytelKcal(110, MAN)).toBeCloseTo(8.428, 3);
  });

  test("never under the awake rate, even where Keytel is", () => {
    // A low flex point (46 bpm) lets a minute at 62 through, where Keytel gives about 1.2 kcal.
    expect(keytelKcal(62, MAN)).toBeLessThan(PER_MIN * 1.2);
    expect(minuteKcal(62, false, { restingHr: 30, maxHr: 70, body: MAN })).toBeCloseTo(
      PER_MIN * 1.2,
      9,
    );
  });

  test("a brisk-walk minute", () => {
    // About 3–4 METs, or 4–5 kcal/min for this man. The method misses on both sides of the flex
    // point: 105 bpm gets the sitting rate, and 110 gets Keytel, which reads high at the bottom
    // of the range it was fitted on (57–90% of max HR, so from 108 bpm here).
    const walk = (bpm: number) => minuteKcal(bpm, false, { ...HR, body: MAN });
    expect(walk(105)).toBeCloseTo(1.44, 2);
    expect(walk(110)).toBeCloseTo(8.43, 2);
    expect(walk(110) / ((MAN.weightKg * 3.5) / 200)).toBeCloseTo(6.4, 1);
  });
});

describe("dayCalories", () => {
  const day = { start: T0, end: T0 + 24 * HOUR };

  test("a day with no heart rate: 8 h asleep, the rest awake", () => {
    const sleep = { start: T0, end: T0 + 8 * HOUR };

    const result = dayCalories({ minutes: [], day, sleep, ...HR, body: MAN });

    expect(result.kcal).toBeCloseTo(PER_MIN * (480 * 0.95 + 960 * 1.2), 6);
    expect(result.activeKcal).toBeCloseTo(result.kcal - 1730, 6);
  });

  test("an hour over the flex point adds Keytel's minutes", () => {
    const minutes = minuteHr(heartRate(T0, T0 + HOUR, () => 150));

    const result = dayCalories({ minutes, day, sleep: null, ...HR, body: MAN });

    const rest = PER_MIN * 1.2 * 1380;
    expect(result.kcal).toBeCloseTo(rest + 60 * keytelKcal(150, MAN), 6);
  });

  test("part of a day spent asleep has no active calories", () => {
    const morning = { start: T0, end: T0 + 6 * HOUR };

    const result = dayCalories({ minutes: [], day: morning, sleep: morning, ...HR, body: MAN });

    expect(result.kcal).toBeCloseTo(PER_MIN * 0.95 * 360, 6);
    expect(result.activeKcal).toBe(0);
  });
});

describe("dayMetrics calories", () => {
  const input = {
    day: { start: T0, end: T0 + 24 * HOUR },
    heartRate: heartRate(T0, T0 + HOUR, () => 120),
    steps: [],
    motion: [],
    sleep: null,
  };
  const profile = { ...MAN, maxHrMeasured: 190 };

  test("are computed with a full profile and resting HR", () => {
    const day = dayMetrics({ ...input, restingHr: 55, profile });

    expect(day.calories?.kcal).toBeGreaterThan(1730 * 1.2);
  });

  test("are left out without weight, height, age or sex", () => {
    for (const missing of ["weightKg", "heightCm", "ageYears", "sex"]) {
      const day = dayMetrics({ ...input, restingHr: 55, profile: { ...profile, [missing]: null } });

      expect(day.calories).toBeNull();
    }
  });

  test("are left out without resting HR", () => {
    expect(dayMetrics({ ...input, restingHr: null, profile }).calories).toBeNull();
  });
});
