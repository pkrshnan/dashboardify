// Puts the single calculations together: everything about one night, and everything about one
// day. Still pure: the caller loads the samples and decides what to do with the results.

import { breathingRate } from "./breathing";
import { minuteHr, predictedMaxHr, restingHr, zoneMinutes } from "./heart-rate";
import { cleanRr, goodWindows, nightHrv } from "./hrv";
import { sleepSkinTemp } from "./skin-temp";
import { rawAngleChanges, sleepWindow } from "./sleep";
import { scoreEpochs, sleepTimes } from "./sleep-epochs";
import { type PastNight, type SleepScore, sleepScore } from "./sleep-score";
import { stepsTaken } from "./steps";
import { type Sex, strain, trimp } from "./strain";
import type { Accel, HeartRate, RrInterval, SkinTemp, StepCounter } from "./types";

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
}

/** Last night's sleep and overnight vitals, from samples covering the evening to midday. */
export function nightMetrics(input: NightInput): NightMetrics | null {
  const sleep = sleepWindow(input.accel);
  if (!sleep) {
    return null;
  }
  const times = sleepTimes(
    sleep,
    scoreEpochs(sleep, rawAngleChanges(input.accel), input.heartRate),
  );
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
  };
}

/** What strain needs to know about you. Read from profile.md in the vault. */
export interface Profile {
  /** Age on the day being scored. */
  ageYears: number | null;
  sex: Sex | null;
  /** A max HR you've actually seen in a hard effort beats any formula. */
  maxHrMeasured: number | null;
}

export interface DayInput {
  heartRate: HeartRate[];
  steps: StepCounter[];
  /** Resting HR from last night, or your recent normal if last night is missing. */
  restingHr: number | null;
  profile: Profile;
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
}

/** The day's activity, from samples covering the local calendar day. */
export function dayMetrics(input: DayInput): DayMetrics {
  const minutes = minuteHr(input.heartRate);
  const bpms = minutes.map((m) => m.bpm);
  const base = {
    wornMin: minutes.length,
    avgHr: bpms.length > 0 ? bpms.reduce((s, b) => s + b, 0) / bpms.length : null,
    maxHr: bpms.length > 0 ? Math.max(...bpms) : null,
    steps: stepsTaken(input.steps),
  };
  const maxHr = profileMaxHr(input.profile);
  if (maxHr === null || input.restingHr === null || maxHr <= input.restingHr) {
    return { ...base, trimp: null, strain: null, zoneMin: null };
  }
  // Without a sex in the profile, use the men's constants (the original, most-cited fit).
  const total = trimp(minutes, input.restingHr, maxHr, input.profile.sex ?? "male");
  return { ...base, trimp: total, strain: strain(total), zoneMin: zoneMinutes(minutes, maxHr) };
}

function profileMaxHr(profile: Profile): number | null {
  if (profile.maxHrMeasured !== null) {
    return profile.maxHrMeasured;
  }
  return profile.ageYears === null ? null : predictedMaxHr(profile.ageYears);
}
