// Light, deep and REM for each asleep epoch, from the night's per-epoch features (H8).
//
// A four-state hidden Markov model decoded with Viterbi. Awake is not inferred here: epochs that
// scoreEpochs scored awake stay awake and asleep ones can't be, so the model only splits sleep.
// Each sleep state explains the features with its own Gaussians (deep: low HR, high HRV, regular
// breathing; REM: higher HR, low HRV, irregular breathing, still), and the transitions carry
// sleep-lab norms about when each stage comes and how long it lasts. Together they give the
// 90-minute cycles without hard-coding them. Every number here is a hand-set prior, to be tuned
// as nights with the strap pile up; nothing checks the result yet except plausibility. See
// docs/health-metrics.md.

import { EPOCH_MS } from "./sleep-epochs";
import type { EpochFeatures } from "./sleep-features";
import { median } from "./stats";

export type Stage = "awake" | "light" | "deep" | "rem";

const STATES: Stage[] = ["awake", "light", "deep", "rem"];
const AWAKE = 0;
const LIGHT = 1;
const DEEP = 2;
const REM = 3;

// ---- emissions: what each stage looks like, in z units against the night's asleep epochs ----

type Feature = "hrZ" | "hrvZ" | "breathingZ";

/**
 * State means, from the direction the literature gives (Fonseca 2017, Walch 2019; breathing:
 * Gutierrez 2016). Deep: vagal drive, so HR down, RMSSD up and breathing very regular. REM:
 * autonomic instability, so HR up, RMSSD down and breathing irregular. Light is the middle and
 * most of the night, so it sits near 0. The sizes are guesses of about one SD, chosen so a
 * typical night's mix (about half light, a fifth deep, a quarter REM) averages to about 0, as
 * z-scores must.
 */
const MEANS: Record<Exclude<Stage, "awake">, Record<Feature, number>> = {
  light: { hrZ: 0, hrvZ: 0, breathingZ: 0 },
  deep: { hrZ: -1, hrvZ: 0.8, breathingZ: 0.8 },
  rem: { hrZ: 0.7, hrvZ: -0.6, breathingZ: -0.8 },
};
/** One spread for every state and feature: under 1, since part of the night's SD is the stages. */
const SD = 0.8;
const FEATURES: Feature[] = ["hrZ", "hrvZ", "breathingZ"];
/**
 * HR falls across a night whatever the stage, partly from the circadian low (Burgess 1997), and
 * is still settling for the first half hour or so. Against the whole night, the start then looks
 * like REM and the morning like deep, as the first real nights did. So HR is taken against the
 * median of the asleep epochs within an hour either side: longer than any one bout, so a stage
 * doesn't cancel itself out.
 */
const TREND_HALF_EPOCHS = 120;

/** A posture change, as sleep-epochs.ts counts one. */
const MOVED_DEG = 5;
/**
 * How likely an asleep epoch is to hold a posture change. Body movements are rarest in deep
 * sleep (Wilde-Frenz & Schulz 1983). REM paralyses the trunk and limbs, so its movements are
 * mostly twitches, under a 5° posture change; posture shifts cluster in light sleep and at stage
 * changes. Stillness is the norm in every stage, so only a movement counts as evidence: scoring
 * stillness too would favour deep on every still epoch. scoreEpochs makes most movements awake,
 * so this mostly decides the lone ones it rescored as sleep.
 */
const MOVED_P: Record<Exclude<Stage, "awake">, number> = { light: 0.08, deep: 0.02, rem: 0.03 };

// ---- transitions: sleep-lab norms, per 30-second epoch ----

/**
 * Where each stage goes when it changes: the share of all a night's transitions from one stage
 * to another, from 48 healthy adults' second lab night (Lo 2013, table 1a; R&K stages, S1+S2 as
 * light, S3+S4 as deep). Their 0.00 entries, deep↔REM above all, become RARE: direct switches
 * are rare, and REM is reached from light.
 */
const RARE = 0.002;
const LEAVE: number[][] = [
  // to: awake, light, deep, REM
  [0, 0.24, RARE, 0.01],
  [0.18, 0, 0.16, 0.11],
  [0.02, 0.14, 0, RARE],
  [0.05, 0.07, RARE, 0],
];
/**
 * Mean bout lengths in minutes (Lo 2013, fig. 5: light 10.9, deep 12.3, REM 9.9). Awake bouts
 * are fixed by the data, so theirs only needs to be plausible.
 */
const AWAKE_BOUT_MIN = 2;
const LIGHT_BOUT_MIN = 10.9;
/**
 * Deep bouts shorten through the night as slow-wave pressure is spent (Carskadon & Dement 2011):
 * 20 min at onset to 5 by 6 hours, about 15 over the first half, where deep mostly is, against
 * Lo's night-long 12.3. Viterbi favours the longest-lasting state when the features say little, so a
 * fixed deep bout longer than light's would turn a featureless night deep.
 */
const FIRST_DEEP_BOUT_MIN = 20;
const LATE_DEEP_BOUT_MIN = 5;
/**
 * REM bouts lengthen through the night: the first may last only 1–5 min, the last third holds
 * the longest (Carskadon & Dement 2011, Principles and Practice of Sleep Medicine). 5 min at the
 * first, growing to 15 over the next 6 hours, averages about 10.5 over a night, near Lo's 9.9.
 */
const FIRST_REM_BOUT_MIN = 5;
const LATE_REM_BOUT_MIN = 15;
const BOUT_CHANGE_MIN = 360;
/**
 * Deep sleep falls mostly in the first third of the night (Carskadon & Dement 2011). Entering it
 * is weighted by GAIN × e^(−t / DECAY): 4× at onset, 1× at about 2¾ h, a tenth by 7 h, and about
 * 1 on average over a 7.6-hour night, the length Lo's matrix averages.
 */
const DEEP_GAIN = 4;
const DEEP_DECAY_MIN = 120;
/**
 * The first cycle's NREM lasts 70–100 min (Carskadon & Dement 2011), so REM before 60 min is
 * rare. REM within minutes of onset is a sign of narcolepsy, not healthy sleep, while HR is
 * still settling then and can look like REM; so before 45 min it isn't allowed at all.
 */
const NO_REM_MIN = 45;
const FIRST_REM_MIN = 60;
const EARLY_REM_WEIGHT = 0.01;

// ---- plausibility: a healthy adult's night, in shares of asleep time ----

/** About 45–55% N2 plus 2–5% N1, 13–23% N3, 20–25% REM (Carskadon & Dement 2011), widened. */
const PLAUSIBLE = { light: [0.4, 0.65], deep: [0.1, 0.25], rem: [0.15, 0.3] } as const;

export interface StageRun {
  start: number;
  end: number;
  stage: Stage;
}

export interface SleepStages {
  /** One per epoch, in the features' order. */
  stages: Stage[];
  /** Consecutive epochs of one stage, awake included, so the runs cover the whole window. */
  runs: StageRun[];
  lightMin: number;
  deepMin: number;
  remMin: number;
  /** False when a share of asleep time falls outside PLAUSIBLE. */
  plausible: boolean;
}

/** Stages for the night's epochs; null without an asleep epoch to stage. */
export function sleepStages(features: EpochFeatures[]): SleepStages | null {
  if (!features.some((f) => f.asleep)) {
    return null;
  }
  const stages = viterbi(detrendHr(features)).map((s) => STATES[s] ?? "light");
  const minutes = (stage: Stage) => (stages.filter((s) => s === stage).length * EPOCH_MS) / 60_000;
  const lightMin = minutes("light");
  const deepMin = minutes("deep");
  const remMin = minutes("rem");
  return {
    stages,
    runs: toRuns(features, stages),
    lightMin,
    deepMin,
    remMin,
    plausible: isPlausible(lightMin, deepMin, remMin),
  };
}

/** The most likely state sequence, in log space; one pass forward, one back. */
function viterbi(features: EpochFeatures[]): number[] {
  const start = features[0]?.ts ?? 0;
  const back: number[][] = [];
  // Sleep starts from wake or light, never straight into deep or REM.
  let scores = STATES.map(
    (_, s) => emission(s, features[0]) + (s === DEEP || s === REM ? Number.NEGATIVE_INFINITY : 0),
  );
  for (let i = 1; i < features.length; i++) {
    const f = features[i];
    const step = transitions(f?.sinceOnsetMin ?? ((f?.ts ?? start) - start) / 60_000);
    const from = STATES.map((_, to) => bestFrom(scores, step, to));
    back.push(from);
    scores = from.map(
      (prev, to) => (scores[prev] ?? 0) + (step[prev]?.[to] ?? 0) + emission(to, f),
    );
  }
  return backtrack(scores, back);
}

/** The previous state with the best score into `to`. */
function bestFrom(scores: number[], step: number[][], to: number): number {
  let best = 0;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (let from = 0; from < scores.length; from++) {
    const score = (scores[from] ?? 0) + (step[from]?.[to] ?? 0);
    if (score > bestScore) {
      best = from;
      bestScore = score;
    }
  }
  return best;
}

function backtrack(scores: number[], back: number[][]): number[] {
  let state = scores.indexOf(Math.max(...scores));
  const path = [state];
  for (let i = back.length - 1; i >= 0; i--) {
    state = back[i]?.[state] ?? LIGHT;
    path.push(state);
  }
  return path.reverse();
}

/** log P(features | state). Null features add nothing; awake follows scoreEpochs exactly. */
function emission(state: number, f: EpochFeatures | undefined): number {
  if (!f || f.asleep === (state === AWAKE)) {
    return Number.NEGATIVE_INFINITY;
  }
  const stage = STATES[state];
  if (stage === undefined || stage === "awake") {
    return 0;
  }
  let log = 0;
  for (const feature of FEATURES) {
    const z = f[feature];
    if (z !== null) {
      log -= (z - MEANS[stage][feature]) ** 2 / (2 * SD * SD);
    }
  }
  return f.movementDeg > MOVED_DEG ? log + Math.log(MOVED_P[stage]) : log;
}

/** HR less the median of the asleep epochs' HR within TREND_HALF_EPOCHS either side. */
function detrendHr(features: EpochFeatures[]): EpochFeatures[] {
  return features.map((f, i) => {
    if (f.hrZ === null) {
      return f;
    }
    const around = features
      .slice(Math.max(0, i - TREND_HALF_EPOCHS), i + TREND_HALF_EPOCHS + 1)
      .filter((n) => n.asleep)
      .map((n) => n.hrZ)
      .filter((z): z is number => z !== null);
    return { ...f, hrZ: f.hrZ - (median(around) ?? 0) };
  });
}

/**
 * log P(next | this) at `t` minutes since onset: stay for the stage's bout length, else leave as
 * Lo's matrix says, with entering deep and REM weighted by the time of night.
 */
export function transitions(t: number): number[][] {
  const entry = [1, 1, deepWeight(t), remWeight(t)];
  const bouts = [
    AWAKE_BOUT_MIN,
    LIGHT_BOUT_MIN,
    changing(FIRST_DEEP_BOUT_MIN, LATE_DEEP_BOUT_MIN, t),
    changing(FIRST_REM_BOUT_MIN, LATE_REM_BOUT_MIN, t - FIRST_REM_MIN),
  ];
  return LEAVE.map((row, from) => {
    const stay = 1 - EPOCH_MS / 60_000 / (bouts[from] ?? 1);
    const weighted = row.map((p, to) => p * (entry[to] ?? 1));
    const total = weighted.reduce((sum, p) => sum + p, 0);
    return weighted.map((p, to) => Math.log(to === from ? stay : ((1 - stay) * p) / total));
  });
}

/** Before onset is drowsy light sleep: deep and REM are rare then. */
function deepWeight(t: number): number {
  return t < 0 ? RARE : DEEP_GAIN * Math.exp(-t / DEEP_DECAY_MIN);
}

function remWeight(t: number): number {
  if (t < NO_REM_MIN) {
    return 0;
  }
  return t < FIRST_REM_MIN ? EARLY_REM_WEIGHT : 1;
}

/** From `first` to `late`, linearly over BOUT_CHANGE_MIN from t = 0. */
function changing(first: number, late: number, t: number): number {
  const done = Math.min(1, Math.max(0, t) / BOUT_CHANGE_MIN);
  return first + done * (late - first);
}

function toRuns(features: EpochFeatures[], stages: Stage[]): StageRun[] {
  const runs: StageRun[] = [];
  stages.forEach((stage, i) => {
    const ts = features[i]?.ts ?? 0;
    const last = runs[runs.length - 1];
    if (last && last.stage === stage && last.end === ts) {
      last.end = ts + EPOCH_MS;
    } else {
      runs.push({ start: ts, end: ts + EPOCH_MS, stage });
    }
  });
  return runs;
}

function isPlausible(lightMin: number, deepMin: number, remMin: number): boolean {
  const asleep = lightMin + deepMin + remMin;
  const within = (min: number, [low, high]: readonly [number, number]) =>
    min / asleep >= low && min / asleep <= high;
  return (
    asleep > 0 &&
    within(lightMin, PLAUSIBLE.light) &&
    within(deepMin, PLAUSIBLE.deep) &&
    within(remMin, PLAUSIBLE.rem)
  );
}
