// What each 30-second epoch of the night looks like, for telling light, deep and REM apart (H9).
//
// The stages differ in how the autonomic nervous system runs the heart and lungs. As NREM sleep
// deepens, vagal drive rises: heart rate falls, beat-to-beat variability rises and breathing
// becomes very regular. REM is autonomic instability: heart rate is higher and jumps about,
// variability falls, and breathing turns irregular, while the body barely moves (Fonseca 2017;
// Gutierrez 2016 for breathing). Adding HR to motion lifts NREM/REM accuracy by 15–25 points
// over motion alone, the weakest single signal for it (Walch 2019). Each feature is a z-score against the night's asleep epochs, since
// the stages are relative to your own night, not to fixed numbers. See docs/health-extended.md.

import { SAMPLE_HZ, sharpestPeak, windowSpectrum } from "./breathing";
import { type CleanBeat, MIN_BEATS, timedDiffs } from "./hrv";
import type { AngleChange } from "./sleep";
import { EPOCH_MS, type Epoch, epochSignals } from "./sleep-epochs";
import { mean, sd } from "./stats";
import type { HeartRate, RrInterval, Span } from "./types";

/** RMSSD over the 5 minutes around each epoch, the standard short-term length. */
const HRV_HALF_MS = 150_000;
/**
 * At least 60 successive differences, the bar a night window has in hrv.ts: about a minute of
 * clean beats, and RMSSD over 60 s agrees well with 5 min (Esco & Flatt 2014; Munoz 2015).
 */
const MIN_DIFFS = MIN_BEATS;
/** Breathing over the 2 minutes around each epoch: 24–60 breaths, enough for a clear peak. */
const BREATH_HALF_MS = 60_000;
/** 110 s of the 120 s window, so every epoch's bins line up (1/110 Hz apart). */
const BREATH_SAMPLES = SAMPLE_HZ * 110;
/** Kept beats must cover 80% of the window, as hrv.ts asks of a night window's beats. */
const MIN_BREATH_COVERAGE = 0.8;

export interface EpochFeatures {
  ts: number;
  /** As scoreEpochs scored it. Awake epochs stay awake in H9. */
  asleep: boolean;
  /** Mean HR, as a z-score. Null with no HR. */
  hrZ: number | null;
  /** ln(RMSSD) over the surrounding 5 minutes, as a z-score. Null with under 60 differences. */
  hrvZ: number | null;
  /**
   * ln(peak ÷ median power) of the 2-minute breathing spectrum, as a z-score. Higher is more
   * regular.
   */
  breathingZ: number | null;
  /** The largest 5-second arm angle change in the epoch, in degrees. */
  movementDeg: number;
  /** Minutes from sleep onset to the epoch's start; negative before it, null with no onset. */
  sinceOnsetMin: number | null;
}

export interface FeatureInput {
  window: Span;
  /** scoreEpochs for the same window, changes and heart rate. */
  epochs: Epoch[];
  /** Sleep onset from sleepTimes. */
  onset: number | null;
  /** rawAngleChanges, as scoreEpochs was given. */
  changes: AngleChange[];
  heartRate: HeartRate[];
  /** cleanRr of the night's beats, sorted by ts. */
  beats: CleanBeat[];
}

/** Features for every epoch of the window, in the same order as scoreEpochs. */
export function epochFeatures(input: FeatureInput): EpochFeatures[] {
  const signals = epochSignals(input.window, input.changes, input.heartRate);
  const asleep = signals.map((_, i) => input.epochs[i]?.asleep === true);
  const centres = signals.map((s) => s.ts + EPOCH_MS / 2);
  const hrZ = zScores(
    signals.map((s) => s.hr),
    asleep,
  );
  const hrvZ = zScores(epochLnRmssd(input.beats, centres), asleep);
  const breathingZ = zScores(epochBreathing(input.beats, centres), asleep);
  const { onset } = input;
  return signals.map((s, i) => ({
    ts: s.ts,
    asleep: asleep[i] === true,
    hrZ: hrZ[i] ?? null,
    hrvZ: hrvZ[i] ?? null,
    breathingZ: breathingZ[i] ?? null,
    movementDeg: s.movementDeg,
    sinceOnsetMin: onset === null ? null : (s.ts - onset) / 60_000,
  }));
}

/** ln(RMSSD) around each centre, from running sums of squared differences: linear in beats. */
export function epochLnRmssd(beats: CleanBeat[], centres: number[]): (number | null)[] {
  const diffs = timedDiffs(beats);
  const squares = runningSums(diffs.map((d) => d.ms * d.ms));
  return windows(diffs, centres, HRV_HALF_MS).map(([from, to]) => {
    const count = to - from;
    const sum = (squares[to] ?? 0) - (squares[from] ?? 0);
    if (count < MIN_DIFFS || sum <= 0) {
      return null;
    }
    return Math.log(Math.sqrt(sum / count));
  });
}

/** How sharp the breathing peak is around each centre, as ln(peak ÷ the band's median power). */
export function epochBreathing(beats: CleanBeat[], centres: number[]): (number | null)[] {
  const covered = runningSums(beats.map((b) => (b.kept ? b.ms : 0)));
  return windows(beats, centres, BREATH_HALF_MS).map(([from, to]) => {
    const keptMs = (covered[to] ?? 0) - (covered[from] ?? 0);
    if (keptMs < MIN_BREATH_COVERAGE * 2 * BREATH_HALF_MS) {
      return null;
    }
    const spectrum = windowSpectrum(beats.slice(from, to), BREATH_SAMPLES);
    const peak = spectrum ? sharpestPeak(spectrum) : null;
    if (peak === null || !Number.isFinite(peak.ratio) || peak.ratio <= 0) {
      return null;
    }
    return Math.log(peak.ratio);
  });
}

/**
 * For each centre (ascending), the index range [from, to) of the items within ± halfMs. Both
 * ends only move forward, so the whole night is one pass.
 */
function windows(items: RrInterval[], centres: number[], halfMs: number): [number, number][] {
  let from = 0;
  let to = 0;
  return centres.map((c) => {
    while (from < items.length && (items[from]?.ts ?? 0) < c - halfMs) {
      from++;
    }
    to = Math.max(to, from);
    while (to < items.length && (items[to]?.ts ?? 0) < c + halfMs) {
      to++;
    }
    return [from, to];
  });
}

/** sums[i] is the total of the first i values. */
function runningSums(values: number[]): number[] {
  const sums = [0];
  for (const v of values) {
    sums.push((sums[sums.length - 1] ?? 0) + v);
  }
  return sums;
}

/** Each value against the mean and SD of the asleep epochs' values. Null where it can't be. */
export function zScores(values: (number | null)[], asleep: boolean[]): (number | null)[] {
  const reference = values.filter((v, i): v is number => v !== null && asleep[i] === true);
  const m = mean(reference);
  const s = sd(reference);
  if (m === null || s === null || s === 0) {
    return values.map(() => null);
  }
  return values.map((v) => (v === null ? null : (v - m) / s));
}
