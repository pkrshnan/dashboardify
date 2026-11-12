// Calories: what the day burned, minute by minute. A base rate from body size, raised when awake,
// walking from steps, and heart rate for the minutes hard enough for it to mean something. Each
// awake minute takes the largest of the three. See docs/health-metrics.md.

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
  /** Steps per minute, keyed by minute start (see stepsPerMinute). */
  steps: Map<number, number>;
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
 * Heart rate is weighed in linearly from the flex point (40% of heart-rate reserve; flex-HR method,
 * Spurr 1988) to full Keytel at 60%. Under the flex point HR says little about energy, and a hard
 * switch there jumped from the sitting rate to jogging numbers in one beat.
 */
const FLEX_RESERVE = 0.4;
const FULL_KEYTEL_RESERVE = 0.6;
/**
 * Step length as a fraction of height: the rule of thumb pedometers use (0.415 for men, 0.413 for
 * women; the gap is under 1%, so one value). Measured ratios run about 0.41–0.47, so this errs low.
 */
const STEP_PER_HEIGHT = 0.415;
/** Under this a minute is a few steps about the house, not a walk; same as walks.ts. */
const MIN_WALK_SPM = 60;
/**
 * ACSM's walking equation holds for about 50–100 m/min. Faster is jogging, which heart rate covers,
 * so the speed is capped rather than extrapolated.
 */
const MAX_WALK_M_PER_MIN = 100;
/** ACSM walking, level ground: VO2 = 3.5 + 0.1 × speed (ml/kg/min, speed in m/min). */
const ACSM_WALK = { rest: 3.5, perMPerMin: 0.1 } as const;
/** About 5 kcal per litre of oxygen on a mixed diet. */
const KCAL_PER_L_O2 = 5;
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

/**
 * Walking's kcal for one minute at `spm` steps, from the ACSM walking equation, or 0 for fewer than
 * a walk's steps. Steps are provisional (the counter's meaning is inferred), and so is this.
 */
export function walkingKcal(spm: number, body: Body): number {
  if (spm < MIN_WALK_SPM) {
    return 0;
  }
  const stepM = (STEP_PER_HEIGHT * body.heightCm) / 100;
  const speed = Math.min(MAX_WALK_M_PER_MIN, spm * stepM);
  const vo2 = ACSM_WALK.rest + ACSM_WALK.perMPerMin * speed;
  return ((vo2 * body.weightKg) / 1000) * KCAL_PER_L_O2;
}

/**
 * Heart rate's kcal for one minute: the awake rate, plus Keytel's excess over it weighed in from 0
 * at the flex point to 1 at 60% of reserve.
 *
 * Keytel likely reads high for light people (13 kcal/min at 150 bpm for 56 kg, where MET tables
 * give about 9), but its sample's mean mass isn't published in any source we could read, and the
 * equation already has its own weight term, so no mass correction is applied.
 */
export function heartRateKcal(
  bpm: number,
  awake: number,
  input: Pick<CalorieInput, "restingHr" | "maxHr" | "body">,
): number {
  const fraction = reserve(bpm, input.restingHr, input.maxHr);
  const ramp = (fraction - FLEX_RESERVE) / (FULL_KEYTEL_RESERVE - FLEX_RESERVE);
  const share = Math.min(1, Math.max(0, ramp));
  return awake + share * Math.max(0, keytelKcal(bpm, input.body) - awake);
}

/**
 * One minute's kcal: asleep, or the largest of sitting, walking and heart rate. A minute with no
 * HR wasn't worn, so it gets the awake rate whatever the steps say.
 */
export function minuteKcal(
  minute: { bpm: number | null; steps: number },
  asleep: boolean,
  input: Pick<CalorieInput, "restingHr" | "maxHr" | "body">,
): number {
  const base = bmr(input.body) / DAY_MIN;
  if (asleep) {
    return base * ASLEEP_FACTOR;
  }
  const awake = base * AWAKE_FACTOR;
  if (minute.bpm === null) {
    return awake;
  }
  return Math.max(
    awake,
    walkingKcal(minute.steps, input.body),
    heartRateKcal(minute.bpm, awake, input),
  );
}

/**
 * The day's calories over every whole minute of `day`, worn or not. BMR is spread evenly over
 * 1,440 minutes, so a 23- or 25-hour day (clocks changing) counts its real minutes.
 */
export function dayCalories(input: CalorieInput): Calories {
  const kcal = spanKcal(input.day, input);
  const count = Math.max(0, Math.floor((input.day.end - input.day.start) / MINUTE_MS));
  const base = (bmr(input.body) / DAY_MIN) * count;
  // Early on a day that started asleep the total can be just under BMR; that isn't negative work.
  return { kcal, activeKcal: Math.max(0, kcal - base) };
}

/** The kcal of every whole minute of `span`, worn or not: a day, or one workout in it. */
export function spanKcal(span: Span, input: Omit<CalorieInput, "day">): number {
  const bpm = new Map(input.minutes.map((m) => [m.ts, m.bpm]));
  const count = Math.max(0, Math.floor((span.end - span.start) / MINUTE_MS));
  let kcal = 0;
  for (let i = 0; i < count; i++) {
    const ts = span.start + i * MINUTE_MS;
    const asleep = input.sleep !== null && ts >= input.sleep.start && ts < input.sleep.end;
    kcal += minuteKcal(
      { bpm: bpm.get(ts) ?? null, steps: input.steps.get(ts) ?? 0 },
      asleep,
      input,
    );
  }
  return kcal;
}
