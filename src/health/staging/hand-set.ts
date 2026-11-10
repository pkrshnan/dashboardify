// H9's hand-set stage model, kept only so train-stages.ts can score it against the fitted one
// on the same held-out nights. Nothing live uses it. The numbers and their sources are as H9
// shipped them; see git history for sleep-stages.ts at H9 for the reasoning behind each.

import type { EpochFeatures } from "../metrics/sleep-features";
import { gaussian, type SleepStage, type StageModel } from "../metrics/sleep-stages";

/** Fonseca 2017, Walch 2019, Gutierrez 2016; about one SD each. */
const MEANS: Record<SleepStage, Record<"hrZ" | "hrvZ" | "breathingZ", number>> = {
  light: { hrZ: 0, hrvZ: 0, breathingZ: 0 },
  deep: { hrZ: -1, hrvZ: 0.8, breathingZ: 0.8 },
  rem: { hrZ: 0.7, hrvZ: -0.6, breathingZ: -0.8 },
};
const SD = 0.8;
const MOVED_DEG = 5;
/** Wilde-Frenz & Schulz 1983. Only a movement counts as evidence. */
const MOVED_P: Record<SleepStage, number> = { light: 0.08, deep: 0.02, rem: 0.03 };

/** Lo 2013, table 1a: where each stage goes when it changes. */
const RARE = 0.002;
const LEAVE: number[][] = [
  [0, 0.24, RARE, 0.01],
  [0.18, 0, 0.16, 0.11],
  [0.02, 0.14, 0, RARE],
  [0.05, 0.07, RARE, 0],
];
/** Bout lengths in minutes (Lo 2013; Carskadon & Dement 2011). */
const AWAKE_BOUT_MIN = 2;
const LIGHT_BOUT_MIN = 10.9;
const FIRST_DEEP_BOUT_MIN = 20;
const LATE_DEEP_BOUT_MIN = 5;
const FIRST_REM_BOUT_MIN = 5;
const LATE_REM_BOUT_MIN = 15;
const BOUT_CHANGE_MIN = 360;
/** Entering deep weighted 4 × e^(−t / 120 min); REM barred before 45 min, rare before 60. */
const DEEP_GAIN = 4;
const DEEP_DECAY_MIN = 120;
const NO_REM_MIN = 45;
const FIRST_REM_MIN = 60;
const EARLY_REM_WEIGHT = 0.01;
const EPOCH_MIN = 0.5;

export const HAND_SET_MODEL: StageModel = {
  emission(stage: SleepStage, f: EpochFeatures): number {
    const m = MEANS[stage];
    const log = gaussian(f.hrZ, m.hrZ, SD) + gaussian(f.hrvZ, m.hrvZ, SD);
    const withBreathing = log + gaussian(f.breathingZ, m.breathingZ, SD);
    return f.movementDeg > MOVED_DEG ? withBreathing + Math.log(MOVED_P[stage]) : withBreathing;
  },
  transitions(t: number): number[][] {
    const entry = [1, 1, deepWeight(t), remWeight(t)];
    const bouts = [
      AWAKE_BOUT_MIN,
      LIGHT_BOUT_MIN,
      changing(FIRST_DEEP_BOUT_MIN, LATE_DEEP_BOUT_MIN, t),
      changing(FIRST_REM_BOUT_MIN, LATE_REM_BOUT_MIN, t - FIRST_REM_MIN),
    ];
    return LEAVE.map((row, from) => {
      const stay = 1 - EPOCH_MIN / (bouts[from] ?? 1);
      const weighted = row.map((p, to) => p * (entry[to] ?? 1));
      const total = weighted.reduce((sum, p) => sum + p, 0);
      return weighted.map((p, to) => Math.log(to === from ? stay : ((1 - stay) * p) / total));
    });
  },
};

function deepWeight(t: number): number {
  return t < 0 ? RARE : DEEP_GAIN * Math.exp(-t / DEEP_DECAY_MIN);
}

function remWeight(t: number): number {
  if (t < NO_REM_MIN) {
    return 0;
  }
  return t < FIRST_REM_MIN ? EARLY_REM_WEIGHT : 1;
}

function changing(first: number, late: number, t: number): number {
  const done = Math.min(1, Math.max(0, t) / BOUT_CHANGE_MIN);
  return first + done * (late - first);
}
