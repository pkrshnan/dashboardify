// Puts the single calculations together: everything about one night, and everything about one
// day. Still pure: the caller loads the samples and decides what to do with the results.

import { breathingRate } from "./breathing";
import { type Body, type CalorieInput, type Calories, dayCalories, spanKcal } from "./calories";
import { type MinuteHr, minuteHr, predictedMaxHr, restingHr, zoneMinutes } from "./heart-rate";
import { cleanRr, goodWindows, nightHrv } from "./hrv";
import { type RecordedRun, runSpan, withRuns } from "./runs";
import { climbs, type SetClimb } from "./sets";
import { sleepSkinTemp } from "./skin-temp";
import { rawAngleChanges, sleepWindow } from "./sleep";
import { scoreEpochs, sleepTimes } from "./sleep-epochs";
import { epochFeatures } from "./sleep-features";
import { type PastNight, type SleepScore, sleepScore } from "./sleep-score";
import { type SleepStages, sleepStages } from "./sleep-stages";
import { stepsPerMinute, stepsTaken } from "./steps";
import { type Sex, strain, trimp } from "./strain";
import type { Accel, HeartRate, Motion, RrInterval, SkinTemp, Span, StepCounter } from "./types";
import { type Walk, walks } from "./walks";
import { BIG_CLIMB_BPM, type Workout, workouts } from "./workouts";

export interface NightInput {
  accel: Accel[];
  heartRate: HeartRate[];
  rr: RrInterval[];
  skinTemp: SkinTemp[];
  /** Earlier nights, oldest first, for sleep need and timing consistency. */
  past: PastNight[];
  /** Your base sleep need in minutes. */
  needMin: number;
  /** A time as local minutes after noon (see SleepTiming). */
  minutesAfterNoon: (ts: number) => number;
}

export interface NightMetrics {
  /** Lay down: the start of the still window. */
  bed: number;
  /** Fell asleep: the first 10 minutes of unbroken sleep (bed if that never happened). */
  onset: number;
  wake: number;
  inBedMin: number;
  asleepMin: number;
  latencyMin: number;
  wakeAfterOnsetMin: number;
  awakenings: number;
  efficiency: number;
  sleep: SleepScore;
  restingHr: number | null;
  rmssdMs: number | null;
  lnRmssd: number | null;
  hrvWindows: number;
  breathingRate: number | null;
  skinTemp: number | null;
  /** Light, deep and REM; null without an asleep epoch. Estimated, checked for plausibility only. */
  stages: SleepStages | null;
}

/** Last night's sleep and overnight vitals, from samples covering the evening to midday. */
export function nightMetrics(input: NightInput): NightMetrics | null {
  const sleep = sleepWindow(input.accel);
  if (!sleep) {
    return null;
  }
  const changes = rawAngleChanges(input.accel);
  const epochs = scoreEpochs(sleep, changes, input.heartRate);
  const times = sleepTimes(sleep, epochs);
  const onset = times.onset ?? sleep.start;
  const timing = {
    onsetMin: input.minutesAfterNoon(onset),
    wakeMin: input.minutesAfterNoon(sleep.end),
  };
  const beats = cleanRr(input.rr);
  const hrv = nightHrv(beats, sleep);
  return {
    bed: sleep.start,
    onset,
    wake: sleep.end,
    inBedMin: (sleep.end - sleep.start) / 60_000,
    asleepMin: times.asleepMin,
    latencyMin: times.latencyMin,
    wakeAfterOnsetMin: times.wakeAfterOnsetMin,
    awakenings: times.awakenings,
    efficiency: times.efficiency,
    sleep: sleepScore({ ...timing, ...times }, input.past, input.needMin),
    restingHr: restingHr(minuteHr(input.heartRate, sleep)),
    rmssdMs: hrv?.rmssdMs ?? null,
    lnRmssd: hrv?.lnRmssd ?? null,
    hrvWindows: hrv?.windows ?? 0,
    breathingRate: breathingRate(goodWindows(beats, sleep)),
    skinTemp: sleepSkinTemp(input.skinTemp, sleep),
    // The same epochs, angle changes and clean beats as above, so nothing is worked out twice.
    stages: sleepStages(
      epochFeatures({ ...input, window: sleep, epochs, onset: times.onset, changes, beats }),
    ),
  };
}

/** What strain and calories need to know about you. Read from profile.md in the vault. */
export interface Profile {
  /** Age on the day being scored. */
  ageYears: number | null;
  sex: Sex | null;
  /** A max HR you've actually seen in a hard effort beats any formula. */
  maxHrMeasured: number | null;
  weightKg: number | null;
  heightCm: number | null;
}

export interface DayInput {
  /** The local day: midnight to midnight, or to now for today. */
  day: Span;
  heartRate: HeartRate[];
  steps: StepCounter[];
  motion: Motion[];
  /** Last night's sleep, which can't hold a workout. */
  sleep: Span | null;
  /** Resting HR from last night, your recent normal if it is missing, or else the closest night's. */
  restingHr: number | null;
  profile: Profile;
  /** Runs recorded in Strava that start this day. */
  runs?: RecordedRun[];
}

export interface DayMetrics {
  wornMin: number;
  avgHr: number | null;
  maxHr: number | null;
  steps: number;
  /** Null when resting or max HR is unknown. */
  trimp: number | null;
  strain: number | null;
  zoneMin: number[] | null;
  /** Empty when resting or max HR is unknown, like strain. */
  workouts: Workout[];
  /** Walks outside workouts. Needs only the step counter. */
  walks: Walk[];
  /** Null without weight, height, age and sex, or without resting or max HR. */
  calories: Calories | null;
}

/** The day's activity, from samples covering the local calendar day. */
export function dayMetrics(input: DayInput): DayMetrics {
  const minutes = minuteHr(input.heartRate);
  const bpms = minutes.map((m) => m.bpm);
  const perMinute = stepsPerMinute(input.steps);
  const sleep = input.sleep ? [input.sleep] : [];
  const effort = effortMetrics(input, minutes, perMinute, sleep);
  const burn = calorieInput(input, minutes, perMinute);
  return {
    wornMin: minutes.length,
    avgHr: bpms.length > 0 ? bpms.reduce((s, b) => s + b, 0) / bpms.length : null,
    maxHr: bpms.length > 0 ? Math.max(...bpms) : null,
    steps: stepsTaken(input.steps),
    ...effort,
    // Each workout's own total, from the same minutes as the day's.
    workouts: effort.workouts.map((w) => ({ ...w, kcal: burn ? spanKcal(w, burn) : null })),
    calories: burn ? dayCalories({ ...burn, day: input.day }) : null,
    // A walk can't be inside a workout: walking to the court is a walk, the game isn't.
    walks: walks(
      perMinute,
      minutes,
      [...sleep, ...effort.workouts],
      (input.runs ?? []).map(runSpan),
    ),
  };
}

type EffortMetrics = Pick<DayMetrics, "trimp" | "strain" | "zoneMin" | "workouts">;

/** Strain, zones and workouts, which all need resting and max HR. */
function effortMetrics(
  input: DayInput,
  minutes: MinuteHr[],
  perMinute: Map<number, number>,
  sleep: Span[],
): EffortMetrics {
  const maxHr = profileMaxHr(input.profile);
  if (maxHr === null || input.restingHr === null || maxHr <= input.restingHr) {
    return { trimp: null, strain: null, zoneMin: null, workouts: [] };
  }
  // Without a sex in the profile, use the men's constants (the original, most-cited fit).
  const sex = input.profile.sex ?? "male";
  const total = trimp(minutes, input.restingHr, maxHr, sex);
  return {
    trimp: total,
    strain: strain(total),
    zoneMin: zoneMinutes(minutes, maxHr),
    workouts: withRuns(
      workouts({
        minutes,
        climbs: dayClimbs(input.heartRate),
        steps: perMinute,
        motion: input.motion,
        restingHr: input.restingHr,
        maxHr,
        sex,
        exclude: sleep,
      }),
      input.runs ?? [],
      { minutes, steps: perMinute, restingHr: input.restingHr, maxHr, sex },
    ),
  };
}

/**
 * Calories need resting and max HR as strain does. Without them every awake minute would get the
 * sitting rate, a total that reads like a real day but leaves out all exercise.
 */
function calorieInput(
  input: DayInput,
  minutes: MinuteHr[],
  steps: Map<number, number>,
): Omit<CalorieInput, "day"> | null {
  const body = profileBody(input.profile);
  const maxHr = profileMaxHr(input.profile);
  if (!body || maxHr === null || input.restingHr === null || maxHr <= input.restingHr) {
    return null;
  }
  return { minutes, steps, sleep: input.sleep, restingHr: input.restingHr, maxHr, body };
}

function profileBody(profile: Profile): Body | null {
  const { weightKg, heightCm, ageYears, sex } = profile;
  if (weightKg === null || heightCm === null || ageYears === null || sex === null) {
    return null;
  }
  return { weightKg, heightCm, ageYears, sex };
}

/** The day's big HR climbs, for lifting's rhythm. */
function dayClimbs(heartRate: HeartRate[]): SetClimb[] {
  const first = heartRate[0];
  const last = heartRate[heartRate.length - 1];
  return first && last
    ? climbs(heartRate, { start: first.ts, end: last.ts + 1 }, BIG_CLIMB_BPM)
    : [];
}

function profileMaxHr(profile: Profile): number | null {
  if (profile.maxHrMeasured !== null) {
    return profile.maxHrMeasured;
  }
  return profile.ageYears === null ? null : predictedMaxHr(profile.ageYears);
}
