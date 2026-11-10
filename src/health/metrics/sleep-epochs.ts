// Asleep or awake, 30 seconds at a time, inside the sleep window.
//
// Stillness alone overcounts sleep: you can lie still and awake. Waking up also shows in the
// heart: each arousal from sleep comes with a burst of sympathetic activity that lifts heart rate
// by 10 or more beats a minute for a few beats to a minute, even without moving. So an epoch is
// scored awake if the arm changed posture, or if heart rate jumped above its local sleeping level.
// Then short flickers are cleaned up the way sleep-lab rescoring rules do (Webster 1982).
// See docs/health-metrics.md.

import type { AngleChange } from "./sleep";
import { median, percentile } from "./stats";
import type { HeartRate, Span } from "./types";

/** The sleep-lab unit. */
export const EPOCH_MS = 30_000;
/** A posture change: the arm angle moved more than 5° between 5-second steps (van Hees 2015). */
const POSTURE_CHANGE_DEG = 5;
/** An arousal: epoch HR at least 8 bpm above the median of the 10 minutes around it. */
const AROUSAL_BPM = 8;
const LOCAL_HR_EPOCHS = 20;
/**
 * Lying awake keeps HR up for minutes, which the local comparison can't see. So an epoch is
 * also awake if HR is 20% above the night's sleeping level (its 10th percentile). REM raises HR
 * too, but typically by 5–10%, so it stays under this line.
 */
const AWAKE_HR_RATIO = 1.2;
const SLEEPING_HR_PERCENTILE = 10;
/** Sleep onset is the first 10 minutes of unbroken sleep. */
const ONSET_EPOCHS = 20;
/** Awakenings shorter than a minute aren't counted as awakenings. */
const MIN_AWAKENING_EPOCHS = 2;

export interface Epoch {
  ts: number;
  asleep: boolean;
}

export interface EpochSignals {
  ts: number;
  moved: boolean;
  /** The largest 5-second arm angle change in the epoch, in degrees (0 with none). */
  movementDeg: number;
  /** Mean HR in the epoch, or null with no HR (off the arm, or a gap). */
  hr: number | null;
}

/** Per-epoch movement and HR. sleep-features.ts reads the same values, so epochs line up. */
export function epochSignals(
  window: Span,
  changes: AngleChange[],
  heartRate: HeartRate[],
): EpochSignals[] {
  const count = Math.floor((window.end - window.start) / EPOCH_MS);
  const movement = epochMovement(window, changes, count);
  const hrSums = new Array<number>(count).fill(0);
  const hrCounts = new Array<number>(count).fill(0);
  const index = (ts: number) => Math.floor((ts - window.start) / EPOCH_MS);
  for (const h of heartRate) {
    const i = index(h.ts);
    if (i >= 0 && i < count) {
      hrSums[i] = (hrSums[i] ?? 0) + h.bpm;
      hrCounts[i] = (hrCounts[i] ?? 0) + 1;
    }
  }
  return movement.map((deg, i) => ({
    ts: window.start + i * EPOCH_MS,
    moved: deg > POSTURE_CHANGE_DEG,
    movementDeg: deg,
    hr: (hrCounts[i] ?? 0) > 0 ? (hrSums[i] ?? 0) / (hrCounts[i] ?? 1) : null,
  }));
}

/** The largest angle change in each epoch. */
function epochMovement(window: Span, changes: AngleChange[], count: number): number[] {
  const movement = new Array<number>(count).fill(0);
  for (const c of changes) {
    const i = Math.floor((c.ts - window.start) / EPOCH_MS);
    if (i >= 0 && i < count) {
      movement[i] = Math.max(movement[i] ?? 0, c.change);
    }
  }
  return movement;
}

/** Whether each epoch's HR jumps above its surroundings, or sits well above sleeping level. */
function arousals(epochs: EpochSignals[]): boolean[] {
  const half = LOCAL_HR_EPOCHS / 2;
  const hrs = epochs.map((e) => e.hr).filter((hr): hr is number => hr !== null);
  const sleeping = percentile(hrs, SLEEPING_HR_PERCENTILE) ?? 0;
  return epochs.map((e, i) => {
    if (e.hr === null) {
      return false;
    }
    if (sleeping > 0 && e.hr >= AWAKE_HR_RATIO * sleeping) {
      return true;
    }
    const around = epochs
      .slice(Math.max(0, i - half), i + half + 1)
      .map((n) => n.hr)
      .filter((hr): hr is number => hr !== null);
    return e.hr - (median(around) ?? e.hr) >= AROUSAL_BPM;
  });
}

/** Score each 30-second epoch of the window from arm movement and heart rate. */
export function scoreEpochs(window: Span, changes: AngleChange[], heartRate: HeartRate[]): Epoch[] {
  const epochs = epochSignals(window, changes, heartRate);
  const aroused = arousals(epochs);
  // No HR at all means the strap was off or out of contact: count it as awake, not as sleep.
  const awake = epochs.map((e, i) => e.moved || aroused[i] === true || e.hr === null);
  return rescore(awake).map((isAwake, i) => ({
    ts: window.start + i * EPOCH_MS,
    asleep: !isAwake,
  }));
}

/**
 * Clean-up rules: a lone awake epoch from a heart-rate blip between sleep is sleep (one fast
 * beat isn't waking up), and a lone sleep epoch between awake ones is awake.
 */
export function rescore(awake: boolean[]): boolean[] {
  return awake.map((isAwake, i) => {
    const before = awake[i - 1];
    const after = awake[i + 1];
    if (before === undefined || after === undefined || before !== after) {
      return isAwake;
    }
    return before;
  });
}

export interface SleepTimes {
  /** First 10 minutes of unbroken sleep. Null if that never happened. */
  onset: number | null;
  asleepMin: number;
  /** Lying down to falling asleep. */
  latencyMin: number;
  /** Awake time after falling asleep (WASO). */
  wakeAfterOnsetMin: number;
  /** Separate awakenings of a minute or more after onset. */
  awakenings: number;
  /** Asleep ÷ time in the window. */
  efficiency: number;
}

export function sleepTimes(window: Span, epochs: Epoch[]): SleepTimes {
  const onsetIndex = epochs.findIndex((_, i) =>
    epochs.slice(i, i + ONSET_EPOCHS).every((e) => e.asleep),
  );
  const asleep = epochs.filter((e) => e.asleep).length;
  const minutes = (n: number) => (n * EPOCH_MS) / 60_000;
  const totalMin = (window.end - window.start) / 60_000;
  if (onsetIndex === -1 || epochs.length < ONSET_EPOCHS) {
    return {
      onset: null,
      asleepMin: minutes(asleep),
      latencyMin: totalMin,
      wakeAfterOnsetMin: 0,
      awakenings: 0,
      efficiency: totalMin > 0 ? minutes(asleep) / totalMin : 0,
    };
  }
  const afterOnset = epochs.slice(onsetIndex);
  return {
    onset: epochs[onsetIndex]?.ts ?? null,
    asleepMin: minutes(asleep),
    latencyMin: minutes(onsetIndex),
    wakeAfterOnsetMin: minutes(afterOnset.filter((e) => !e.asleep).length),
    awakenings: countAwakenings(afterOnset),
    efficiency: minutes(asleep) / totalMin,
  };
}

function countAwakenings(epochs: Epoch[]): number {
  let count = 0;
  let run = 0;
  for (const e of [...epochs, { ts: 0, asleep: true }]) {
    if (!e.asleep) {
      run++;
      continue;
    }
    if (run >= MIN_AWAKENING_EPOCHS) {
      count++;
    }
    run = 0;
  }
  return count;
}
