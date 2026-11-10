import { describe, expect, test } from "bun:test";
import {
  type Body,
  bmr,
  dayCalories,
  keytelKcal,
  minuteKcal,
  walkingKcal,
} from "../../../src/health/metrics/calories";
import { minuteHr } from "../../../src/health/metrics/heart-rate";
import { dayMetrics } from "../../../src/health/metrics/summary";
import { HOUR, heartRate, T0 } from "./fixtures";

const MAN: Body = { weightKg: 75, heightCm: 180, ageYears: 30, sex: "male" };
const WOMAN: Body = { weightKg: 60, heightCm: 165, ageYears: 30, sex: "female" };
// Flex point: 55 + 0.4 × (190 − 55) = 109 bpm.
const HR = { restingHr: 55, maxHr: 190 };
const PER_MIN = 1730 / 1440;
// The user this was tuned for. Flex point: 55 + 0.4 × (205 − 55) = 115 bpm; full Keytel from 145.
const LIGHT: Body = { weightKg: 56, heightCm: 168, ageYears: 26, sex: "male" };
const LIGHT_HR = { restingHr: 55, maxHr: 205, body: LIGHT };
const NO_STEPS = new Map<number, number>();

describe("bmr", () => {
  test("Mifflin–St Jeor for a known man and woman", () => {
    // 10 × 75 + 6.25 × 180 − 5 × 30 + 5, and 10 × 60 + 6.25 × 165 − 5 × 30 − 161.
    expect(bmr(MAN)).toBe(1730);
    expect(bmr(WOMAN)).toBe(1320.25);
  });
});

describe("minuteKcal", () => {
  const at = (bpm: number | null, steps = 0) => ({ bpm, steps });

  test("asleep is BMR × 0.95 whatever the heart rate or steps", () => {
    expect(minuteKcal(at(140, 120), true, { ...HR, body: MAN })).toBeCloseTo(PER_MIN * 0.95, 9);
  });

  test("not worn is BMR × 1.2, even with steps", () => {
    expect(minuteKcal(at(null, 120), false, { ...HR, body: MAN })).toBeCloseTo(PER_MIN * 1.2, 9);
  });

  test("no jump at the flex point", () => {
    const under = minuteKcal(at(114), false, LIGHT_HR);
    const over = minuteKcal(at(116), false, LIGHT_HR);

    expect(under).toBeCloseTo((bmr(LIGHT) / 1440) * 1.2, 9);
    expect(over - under).toBeGreaterThan(0);
    expect(over - under).toBeLessThan(0.5);
  });

  test("full Keytel from 60% of reserve", () => {
    expect(minuteKcal(at(150), false, LIGHT_HR)).toBeCloseTo(keytelKcal(150, LIGHT), 9);
    // (−55.0969 + 0.6309 × 110 + 0.1988 × 75 + 0.2017 × 30) kJ ÷ 4.184.
    expect(keytelKcal(110, MAN)).toBeCloseTo(8.428, 3);
  });

  test("never under the awake rate, even where Keytel is", () => {
    // A low flex point (46 bpm) lets a minute at 62 through, where Keytel gives about 1.2 kcal.
    expect(keytelKcal(62, MAN)).toBeLessThan(PER_MIN * 1.2);
    expect(minuteKcal(at(62), false, { restingHr: 30, maxHr: 70, body: MAN })).toBeCloseTo(
      PER_MIN * 1.2,
      9,
    );
  });

  test("a brisk walk counts from steps, about 3 kcal", () => {
    // 105 × 0.415 × 1.68 = 73 m/min; (3.5 + 7.3) ml/kg/min × 56 kg × 5 kcal/L = 3.0 kcal.
    const walk = minuteKcal(at(110, 105), false, LIGHT_HR);

    expect(walk).toBeGreaterThan(2.5);
    expect(walk).toBeLessThan(4);
    expect(walk).toBeCloseTo(walkingKcal(105, LIGHT), 9);
  });

  test("a 150 bpm minute is well above walking", () => {
    expect(minuteKcal(at(150, 105), false, LIGHT_HR)).toBeGreaterThan(2 * walkingKcal(105, LIGHT));
  });

  test("walking needs a walk's cadence and stops at 100 m/min", () => {
    expect(walkingKcal(59, LIGHT)).toBe(0);
    // 100 m/min: (3.5 + 10) × 56 ÷ 1000 × 5.
    expect(walkingKcal(170, LIGHT)).toBeCloseTo(3.78, 9);
    expect(walkingKcal(170, LIGHT)).toBe(walkingKcal(200, LIGHT));
  });
});

describe("dayCalories", () => {
  const day = { start: T0, end: T0 + 24 * HOUR };

  test("a day with no heart rate: 8 h asleep, the rest awake", () => {
    const sleep = { start: T0, end: T0 + 8 * HOUR };

    const result = dayCalories({ minutes: [], steps: NO_STEPS, day, sleep, ...HR, body: MAN });

    expect(result.kcal).toBeCloseTo(PER_MIN * (480 * 0.95 + 960 * 1.2), 6);
    expect(result.activeKcal).toBeCloseTo(result.kcal - 1730, 6);
  });

  test("an hour at full Keytel adds Keytel's minutes", () => {
    const minutes = minuteHr(heartRate(T0, T0 + HOUR, () => 150));

    const result = dayCalories({ minutes, steps: NO_STEPS, day, sleep: null, ...HR, body: MAN });

    const rest = PER_MIN * 1.2 * 1380;
    expect(result.kcal).toBeCloseTo(rest + 60 * keytelKcal(150, MAN), 6);
  });

  test("part of a day spent asleep has no active calories", () => {
    const morning = { start: T0, end: T0 + 6 * HOUR };

    const result = dayCalories({
      minutes: [],
      steps: NO_STEPS,
      day: morning,
      sleep: morning,
      ...HR,
      body: MAN,
    });

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
    // Height feeds BMR as well as walking, so without it there is no total to give.
    for (const missing of ["weightKg", "heightCm", "ageYears", "sex"]) {
      const day = dayMetrics({ ...input, restingHr: 55, profile: { ...profile, [missing]: null } });

      expect(day.calories).toBeNull();
    }
  });

  test("are left out without resting HR", () => {
    expect(dayMetrics({ ...input, restingHr: null, profile }).calories).toBeNull();
  });
});
