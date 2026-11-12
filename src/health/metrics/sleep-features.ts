// What each 30-second epoch of the night looks like, for telling light, deep and REM apart (H9).
//
// The stages differ in how the autonomic nervous system runs the heart and lungs. As NREM sleep
// deepens, vagal drive rises: heart rate falls, beat-to-beat variability rises and breathing
// becomes very regular. REM is autonomic instability: heart rate is higher and jumps about,
// variability falls, and breathing turns irregular, while the body barely moves (Fonseca 2017;
// Gutierrez 2016 for breathing). Adding HR to motion lifts NREM/REM accuracy by 15–25 points
// over motion alone, the weakest single signal for it (Walch 2019). DFA α1 adds how correlated
// the gaps are, low in deep sleep and high in REM (dfa.ts). Each feature is a z-score against
// the night's asleep epochs, since the stages are relative to your own night, not to fixed
// numbers. See docs/health-metrics.md.

import { SAMPLE_HZ, sharpestPeak, windowSpectrum } from "./breathing";
import { dfaAlpha1 } from "./dfa";
import { type CleanBeat, continuityBreaks, MIN_BEATS, timedDiffs } from "./hrv";
import type { AngleChange } from "./sleep";
import { arousals, EPOCH_MS, type Epoch, epochSignals } from "./sleep-epochs";
import { mean, sd } from "./stats";
import type { HeartRate, RrInterval, Span } from "./types";

/** RMSSD over the 5 minutes around each epoch, the standard short-term length. */
const HRV_HALF_MS = 150_000;
/**
 * At least 60 successive differences, the bar a night window has in hrv.ts: about a minute of
 * clean beats, and RMSSD over 60 s agrees well with 5 min (Esco & Flatt 2014; Munoz 2015).
 */
const MIN_DIFFS = MIN_BEATS;
/**
 * A run of up to this many dropped gaps is left out and the beats either side joined; a longer
 * one, or a missing beat, ends the run. A lone dropped gap is usually one missed or extra beat;
 * 1–3% of them bias α1 only a little (Rogers 2021, Sensors 21:821), and they are rarer than
 * that on the strap's nights. Bridging them lifts the epochs with α1 by about 10 points.
 */
const DFA_MAX_BRIDGED = 1;
/** Breathing over the 2 minutes around each epoch: 24–60 breaths, enough for a clear peak. */
const BREATH_HALF_MS = 60_000;
/** 110 s of the 120 s window, so every epoch's bins line up (1/110 Hz apart). */
const BREATH_SAMPLES = SAMPLE_HZ * 110;
/** Kept beats must cover 80% of the window, as hrv.ts asks of a night window's beats. */
const MIN_BREATH_COVERAGE = 0.8;

export interface EpochFeatures {
  ts: number;
  /** As scoreEpochs scored it. Before onset its awake epochs stay awake. */
  asleep: boolean;
  /** HR jumped above its surroundings or sat well above sleeping level, as scoreEpochs saw it. */
  arousal: boolean;
  /** Mean HR, as a z-score. Null with no HR. */
  hrZ: number | null;
  /** ln(RMSSD) over the surrounding 5 minutes, as a z-score. Null with under 60 differences. */
  hrvZ: number | null;
  /**
   * DFA α1 over the longest run of clean, consecutive beats in the surrounding 5 minutes, as a
   * z-score. Null under 100 beats.
   */
  dfaZ: number | null;
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
  const aroused = arousals(signals);
  const centres = signals.map((s) => s.ts + EPOCH_MS / 2);
  const hrZ = zScores(
    signals.map((s) => s.hr),
    asleep,
  );
  const hrvZ = zScores(epochLnRmssd(input.beats, centres), asleep);
  const breathingZ = zScores(epochBreathing(input.beats, centres), asleep);
  const dfaZ = zScores(epochDfa(input.beats, centres), asleep);
  const { onset } = input;
  return signals.map((s, i) => ({
    ts: s.ts,
    asleep: asleep[i] === true,
    arousal: aroused[i] === true,
    hrZ: hrZ[i] ?? null,
    hrvZ: hrvZ[i] ?? null,
    dfaZ: dfaZ[i] ?? null,
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

/** Raw DFA α1 around each centre, over the window's longest run of clean beats. */
export function epochDfa(
  beats: CleanBeat[],
  centres: number[],
  maxBridged = DFA_MAX_BRIDGED,
): (number | null)[] {
  const ids = runIds(beats, continuityBreaks(beats), maxBridged);
  return windows(beats, centres, HRV_HALF_MS).map(([from, to]) =>
    dfaAlpha1(longestRun(beats, ids, from, to)),
  );
}

/**
 * Which run each beat is in: a new run starts at a break and after more than maxBridged
 * dropped gaps in a row.
 */
function runIds(beats: CleanBeat[], breaks: boolean[], maxBridged: number): number[] {
  let id = 0;
  let dropped = 0;
  return beats.map((beat, i) => {
    if (breaks[i] === true) {
      id++;
      dropped = 0;
    }
    dropped = beat.kept ? 0 : dropped + 1;
    if (dropped > maxBridged) {
      id++;
    }
    return id;
  });
}

/** The kept gaps of the longest run within beats[from, to). */
function longestRun(beats: CleanBeat[], ids: number[], from: number, to: number): number[] {
  let best: number[] = [];
  let run: number[] = [];
  let id = -1;
  for (let i = from; i < to; i++) {
    const beat = beats[i];
    if (!beat?.kept) {
      continue;
    }
    if (ids[i] !== id) {
      id = ids[i] ?? -1;
      run = [];
    }
    run.push(beat.ms);
    best = run.length > best.length ? run : best;
  }
  return best;
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

/**
 * Each value against the mean and SD of the asleep epochs' values. Null where it can't be. With
 * no spread every value is at the mean, so 0: null would read as no HR, a cue for awake.
 */
export function zScores(values: (number | null)[], asleep: boolean[]): (number | null)[] {
  const reference = values.filter((v, i): v is number => v !== null && asleep[i] === true);
  const m = mean(reference);
  const s = sd(reference);
  if (m === null || s === null) {
    return values.map(() => null);
  }
  return values.map((v) => {
    if (v === null) {
      return null;
    }
    return s === 0 ? 0 : (v - m) / s;
  });
}
