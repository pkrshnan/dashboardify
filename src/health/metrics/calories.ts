// Calories: what the day burned, minute by minute. A base rate from body size, raised when awake,
// and heart rate for the minutes hard enough for it to mean something. See docs/health-metrics.md.

import type { MinuteHr } from "./heart-rate";
import { reserve, type Sex } from "./strain";
import { MINUTE_MS, type Span } from "./types";

/** What calories need to know about you; without any of it there are no calories. */
export interface Body {
  weightKg: number;
  heightCm: number;
  ageYears: number;
  sex: Sex;
}

export interface CalorieInput {
  /** Per-minute HR for the day. */
  minutes: MinuteHr[];
  /** The local day, or the part of today so far. */
  day: Span;
  /** Last night's sleep window. */
  sleep: Span | null;
  restingHr: number;
  maxHr: number;
  body: Body;
}

export interface Calories {
  kcal: number;
  /** Total minus BMR for the same minutes. */
  activeKcal: number;
}

/**
 * Mifflin–St Jeor 1990 (Am J Clin Nutr 51:241), kcal/day: 10 × kg + 6.25 × cm − 5 × age, plus 5
 * for men or −161 for women.
 */
const MIFFLIN = { kg: 10, cm: 6.25, age: -5, male: 5, female: -161 } as const;
/** Sleeping metabolism runs about 5% under BMR. */
const ASLEEP_FACTOR = 0.95;
/** Awake and sitting about: the usual "sedentary" multiplier on BMR. */
const AWAKE_FACTOR = 1.2;
/**
 * Keytel 2005 (J Sports Sci 23:289), the equations without VO2max, kJ/min from HR (bpm), weight
 * (kg) and age (years).
 */
const KEYTEL = {
  male: { c: -55.0969, hr: 0.6309, kg: 0.1988, age: 0.2017 },
  female: { c: -20.4022, hr: 0.4472, kg: -0.1263, age: 0.074 },
} as const;
const KJ_PER_KCAL = 4.184;
/**
 * The flex point, as a fraction of heart-rate reserve. Under it, HR says little about energy and
 * Keytel overestimates, so the minute gets the awake rate instead (flex-HR method, Spurr 1988).
 */
const FLEX_RESERVE = 0.4;
const DAY_MIN = 1440;

/** Resting energy expenditure in kcal/day. */
export function bmr(body: Body): number {
  return (
    MIFFLIN.kg * body.weightKg +
    MIFFLIN.cm * body.heightCm +
    MIFFLIN.age * body.ageYears +
    MIFFLIN[body.sex]
  );
}

/** Keytel's estimate for one minute at `bpm`, in kcal. */
export function keytelKcal(bpm: number, body: Body): number {
  const k = KEYTEL[body.sex];
  return (k.c + k.hr * bpm + k.kg * body.weightKg + k.age * body.ageYears) / KJ_PER_KCAL;
}

/** One minute's kcal. A minute with no HR is taken at resting HR, so it gets the awake rate. */
export function minuteKcal(
  bpm: number | null,
  asleep: boolean,
  input: Omit<CalorieInput, "minutes" | "day" | "sleep">,
): number {
  const base = bmr(input.body) / DAY_MIN;
  if (asleep) {
    return base * ASLEEP_FACTOR;
  }
  const awake = base * AWAKE_FACTOR;
  if (bpm === null || reserve(bpm, input.restingHr, input.maxHr) <= FLEX_RESERVE) {
    return awake;
  }
  return Math.max(awake, keytelKcal(bpm, input.body));
}

/**
 * The day's calories over every whole minute of `day`, worn or not. BMR is spread evenly over
 * 1,440 minutes, so a 23- or 25-hour day (clocks changing) counts its real minutes.
 */
export function dayCalories(input: CalorieInput): Calories {
  const bpm = new Map(input.minutes.map((m) => [m.ts, m.bpm]));
  const count = Math.max(0, Math.floor((input.day.end - input.day.start) / MINUTE_MS));
  let kcal = 0;
  for (let i = 0; i < count; i++) {
    const ts = input.day.start + i * MINUTE_MS;
    const asleep = input.sleep !== null && ts >= input.sleep.start && ts < input.sleep.end;
    kcal += minuteKcal(bpm.get(ts) ?? null, asleep, input);
  }
  const base = (bmr(input.body) / DAY_MIN) * count;
  // Early on a day that started asleep the total can be just under BMR; that isn't negative work.
  return { kcal, activeKcal: Math.max(0, kcal - base) };
}
