// Light, deep and REM for each asleep epoch, from the night's per-epoch features (H8).
//
// A four-state hidden Markov model decoded with Viterbi. Awake is not inferred here: epochs that
// scoreEpochs scored awake stay awake and asleep ones can't be, so the model only splits sleep.
// Each sleep state explains the features with its own likelihoods, and the transitions, which
// change with the time since onset, carry when each stage comes and how long it lasts. Together
// they give the 90-minute cycles without hard-coding them.
//
// The HR, movement and transition parts are fitted to sleep-lab-labelled nights by
// src/health/train-stages.ts (H12) and read from stage-params.json; HRV and breathing are still
// hand-set, since that data has no beat-to-beat intervals. See docs/health-metrics.md.

import { EPOCH_MS } from "./sleep-epochs";
import type { EpochFeatures } from "./sleep-features";
import PARAMS_JSON from "./stage-params.json";
import { median } from "./stats";

export type Stage = "awake" | "light" | "deep" | "rem";
export type SleepStage = Exclude<Stage, "awake">;

export const STATES: Stage[] = ["awake", "light", "deep", "rem"];
const AWAKE = 0;
const LIGHT = 1;
const DEEP = 2;
const REM = 3;

/** What train-stages.ts writes. Probabilities; rows and columns of a matrix in STATES order. */
export interface StageParams {
  provenance: Record<string, string | number>;
  /** Detrended hrZ per stage: a Gaussian. */
  hr: Record<SleepStage, { mean: number; sd: number }>;
  /** movementDeg falls in bin i when it is at least edgesDeg[i - 1] and under edgesDeg[i]. */
  movement: { edgesDeg: number[]; p: Record<SleepStage, number[]> };
  /** One matrix before onset, then one per binMin minutes since onset; the last runs on. */
  transitions: { binMin: number; beforeOnset: number[][]; sinceOnset: number[][][] };
  /** [low, high] share of asleep time outside which a night is flagged. */
  plausible: Record<SleepStage, number[]>;
}

export const STAGE_PARAMS: StageParams = PARAMS_JSON;

/** A way to score epochs: log likelihoods and log transitions. sleepStages decodes with one. */
export interface StageModel {
  /** log P(features | stage) for an asleep epoch. */
  emission(stage: SleepStage, f: EpochFeatures): number;
  /** log P(next | this) at `t` minutes since onset. */
  transitions(t: number): number[][];
}

// ---- hand-set until H14 fits them per person ----

/**
 * HRV and breathing, from the direction the literature gives (Fonseca 2017; breathing: Gutierrez
 * 2016). Deep: vagal drive, so RMSSD up and breathing very regular. REM: autonomic instability,
 * so RMSSD down and breathing irregular. Light sits near 0. The sizes are guesses of about one
 * SD; nothing has checked them, since the training data has no RR.
 */
const HAND_SET: Record<SleepStage, Record<"hrvZ" | "breathingZ", number>> = {
  light: { hrvZ: 0, breathingZ: 0 },
  deep: { hrvZ: 0.8, breathingZ: 0.8 },
  rem: { hrvZ: -0.6, breathingZ: -0.8 },
};
const HAND_SET_SD = 0.8;

/**
 * HR falls across a night whatever the stage, partly from the circadian low (Burgess 1997), and
 * is still settling for the first half hour or so. So HR is taken against the median of the
 * asleep epochs within an hour either side: longer than any one bout, so a stage doesn't cancel
 * itself out. Training saw HR the same way.
 */
const TREND_HALF_EPOCHS = 120;

/**
 * REM within minutes of onset is a sign of narcolepsy, not healthy sleep (Carskadon & Dement
 * 2011), while HR is still settling then and can look like REM. The lab nights agree: 20 of 2,700
 * epochs in the first 45 min, on one night of 30. The fitted bins are 30 min wide and lean on the
 * night-wide rate, so they can't say this by themselves.
 */
const NO_REM_MIN = 45;

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
  /** False when a share of asleep time falls outside STAGE_PARAMS.plausible. */
  plausible: boolean;
}

/** The model from fitted params, with HRV and breathing hand-set. */
export function trainedModel(params: StageParams): StageModel {
  const before = logRows(withoutRem(params.transitions.beforeOnset));
  const bins = params.transitions.sinceOnset.map(logRows);
  const noRem = params.transitions.sinceOnset.map((m) => logRows(withoutRem(m)));
  const logMoved = {
    light: againstStill(params.movement.p.light),
    deep: againstStill(params.movement.p.deep),
    rem: againstStill(params.movement.p.rem),
  };
  return {
    emission(stage, f) {
      const { mean, sd } = params.hr[stage];
      const bin = params.movement.edgesDeg.filter((edge) => f.movementDeg >= edge).length;
      return (
        gaussian(f.hrZ, mean, sd) +
        gaussian(f.hrvZ, HAND_SET[stage].hrvZ, HAND_SET_SD) +
        gaussian(f.breathingZ, HAND_SET[stage].breathingZ, HAND_SET_SD) +
        (logMoved[stage][bin] ?? 0)
      );
    },
    transitions(t) {
      if (t < 0) {
        return before;
      }
      const bin = Math.min(Math.floor(t / params.transitions.binMin), bins.length - 1);
      return t < NO_REM_MIN ? (noRem[bin] ?? before) : (bins[bin] ?? before);
    },
  };
}

const TRAINED = trainedModel(STAGE_PARAMS);

/** log N(z; mean, sd) up to a constant shared by every state; null features add nothing. */
export function gaussian(z: number | null, mean: number, sd: number): number {
  return z === null ? 0 : -((z - mean) ** 2) / (2 * sd * sd) - Math.log(sd);
}

/** The matrix with no way into REM. */
function withoutRem(matrix: number[][]): number[][] {
  return matrix.map((row, from) => row.map((p, to) => (to === REM && from !== REM ? 0 : p)));
}

/**
 * log P(bin | stage) ÷ P(still | stage). Stillness is the norm in every stage, and a night has
 * hundreds of still epochs, so scoring it would add up to a steady pull toward whichever stage is
 * stillest (deep) whatever the heart says; on held-out nights that cost accuracy and turned a
 * featureless night deep. So only a movement counts as evidence.
 */
function againstStill(p: number[]): number[] {
  const still = p[0] ?? 1;
  return p.map((v) => Math.log(v / still));
}

/** Rows normalised (the file rounds them) and logged. */
function logRows(matrix: number[][]): number[][] {
  return matrix.map((row) => {
    const total = row.reduce((sum, p) => sum + p, 0);
    return row.map((p) => Math.log(p / total));
  });
}

/** Stages for the night's epochs; null without an asleep epoch to stage. */
export function sleepStages(
  features: EpochFeatures[],
  model: StageModel = TRAINED,
): SleepStages | null {
  if (!features.some((f) => f.asleep)) {
    return null;
  }
  const stages = viterbi(detrendHr(features), model).map((s) => STATES[s] ?? "light");
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

/** Minutes since onset, or since the first epoch without an onset, as the transitions use. */
export function epochTime(features: EpochFeatures[], i: number): number {
  const f = features[i];
  const start = features[0]?.ts ?? 0;
  return f?.sinceOnsetMin ?? ((f?.ts ?? start) - start) / 60_000;
}

/** The most likely state sequence, in log space; one pass forward, one back. */
function viterbi(features: EpochFeatures[], model: StageModel): number[] {
  const back: number[][] = [];
  // Sleep starts from wake or light, never straight into deep or REM.
  let scores = STATES.map(
    (_, s) =>
      emission(model, s, features[0]) + (s === DEEP || s === REM ? Number.NEGATIVE_INFINITY : 0),
  );
  for (let i = 1; i < features.length; i++) {
    const step = model.transitions(epochTime(features, i));
    const from = STATES.map((_, to) => bestFrom(scores, step, to));
    back.push(from);
    scores = from.map(
      (prev, to) =>
        (scores[prev] ?? 0) + (step[prev]?.[to] ?? 0) + emission(model, to, features[i]),
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

/** The model's likelihood, except that awake follows scoreEpochs exactly. */
function emission(model: StageModel, state: number, f: EpochFeatures | undefined): number {
  if (!f || f.asleep === (state === AWAKE)) {
    return Number.NEGATIVE_INFINITY;
  }
  const stage = STATES[state];
  return stage === undefined || stage === "awake" ? 0 : model.emission(stage, f);
}

/** HR less the median of the asleep epochs' HR within TREND_HALF_EPOCHS either side. */
export function detrendHr(features: EpochFeatures[]): EpochFeatures[] {
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

/** log P(next | this) at `t` minutes since onset, from the fitted matrices. */
export function transitions(t: number): number[][] {
  return TRAINED.transitions(t);
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
  const within = (min: number, [low = 0, high = 1]: number[]) =>
    min / asleep >= low && min / asleep <= high;
  const { plausible } = STAGE_PARAMS;
  return (
    asleep > 0 &&
    within(lightMin, plausible.light) &&
    within(deepMin, plausible.deep) &&
    within(remMin, plausible.rem)
  );
}
