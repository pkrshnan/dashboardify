// Awake, light, deep and REM for each epoch, from the night's features (H8; awake since algo 16).
//
// A four-state hidden Markov model decoded with Viterbi. Before sleep onset, scoreEpochs decides
// awake and the model only splits its asleep epochs. After onset awake is a state like the
// others, decoded with them: one fast epoch in REM is far likelier REM with a blip than a
// 30-second awakening, which scoring each epoch alone couldn't weigh. Each state explains the
// features with its own likelihoods, and the transitions, which change with the time since
// onset, carry when each stage comes and how long it lasts. Together they give the 90-minute
// cycles without hard-coding them.
//
// The HR, movement, HR-cue and transition parts are fitted to sleep-lab-labelled nights by
// src/health/train-stages.ts (H12) and read from stage-params.json. That data has no beat-to-beat
// intervals, so HRV, breathing and DFA α1 start hand-set, and src/health/fit-stages.ts can fit
// them to your own nights (H14). See docs/health-metrics.md.

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
  /** Detrended hrZ per stage, in epochs without an arousal: a Gaussian. */
  hr: Record<Stage, { mean: number; sd: number }>;
  /** movementDeg falls in bin i when it is at least edgesDeg[i - 1] and under edgesDeg[i]. */
  movement: { edgesDeg: number[]; p: Record<Stage, number[]> };
  /** The chance of each HR cue (heartCue) per stage. */
  heartCue: { p: Record<Stage, number[]> };
  /** One matrix before onset, then one per binMin minutes since onset; the last runs on. */
  transitions: { binMin: number; beforeOnset: number[][]; sinceOnset: number[][][] };
  /** [low, high] share of asleep time outside which a night is flagged. */
  plausible: Record<SleepStage, number[]>;
}

export const STAGE_PARAMS: StageParams = PARAMS_JSON;

/** A way to score epochs: log likelihoods and log transitions. sleepStages decodes with one. */
export interface StageModel {
  /** log P(features | stage), up to a constant shared by every stage. */
  emission(stage: Stage, f: EpochFeatures): number;
  /** log P(next | this) at `t` minutes since onset. */
  transitions(t: number): number[][];
}

// ---- HRV, breathing and DFA α1: hand-set, or fitted to your nights (H14) ----

/** The features the per-person fit re-estimates; HR is the trained file's. */
export const FITTED_FEATURES = ["hrvZ", "breathingZ", "dfaZ"] as const;
export type FittedFeature = (typeof FITTED_FEATURES)[number];

export interface Gaussian {
  mean: number;
  sd: number;
}

/** A Gaussian per sleep stage and fitted feature. */
export type StageEmissions = Record<SleepStage, Record<FittedFeature, Gaussian>>;

export const SLEEP_STAGES: SleepStage[] = ["light", "deep", "rem"];

/**
 * What scoreEpochs' heart rule saw in an epoch: nothing (0), an arousal binned by its detrended
 * hrZ at these edges (1–4), or no HR at all (5). A Gaussian fits a stage's calm HR, but not the
 * jumps: one over both would be wide enough to let every stage explain any epoch, and its tail
 * would decide an HR of 150 by whichever stage the lab data happened to give the widest spread.
 * Bins say only how often each stage has a jump that size.
 */
export const AROUSAL_EDGES_Z = [2, 4, 8];
export const HEART_CUES = AROUSAL_EDGES_Z.length + 3;

export function heartCue(f: EpochFeatures): number {
  if (f.hrZ === null) {
    return HEART_CUES - 1;
  }
  const z = f.hrZ;
  return f.arousal ? 1 + AROUSAL_EDGES_Z.filter((edge) => z >= edge).length : 0;
}

/**
 * HRV and breathing, from the direction the literature gives (Fonseca 2017; breathing: Gutierrez
 * 2016). Deep: vagal drive, so RMSSD up and breathing very regular. REM: autonomic instability,
 * so RMSSD down and breathing irregular. Light sits near 0. The sizes are guesses of about one
 * SD; nothing has checked them, since the training data has no RR.
 *
 * DFA α1 (H13): beat-to-beat correlations are lost in deep sleep and strong in REM (Bunde 2000;
 * Penzel 2003). On six real nights α1 averaged 0.76 in epochs decoded deep, 0.86 light and 1.15
 * REM, so it agrees with the HR and time parts; the means are kept small until fitted per person.
 *
 * Used until fit-stages.ts applies your own (params.ts).
 */
const HAND_SET_SD = 0.8;
const handSet = (hrvZ: number, breathingZ: number, dfaZ: number) => ({
  hrvZ: { mean: hrvZ, sd: HAND_SET_SD },
  breathingZ: { mean: breathingZ, sd: HAND_SET_SD },
  dfaZ: { mean: dfaZ, sd: HAND_SET_SD },
});
export const DEFAULT_EMISSIONS: StageEmissions = {
  light: handSet(0, 0, 0),
  deep: handSet(0.8, 0.8, -0.6),
  rem: handSet(-0.6, -0.8, 0.5),
};

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

/** The model from trained params, with HRV, breathing and DFA α1 hand-set or your own. */
export function trainedModel(
  params: StageParams,
  emissions: StageEmissions = DEFAULT_EMISSIONS,
): StageModel {
  const before = logRows(withoutRem(params.transitions.beforeOnset));
  const bins = params.transitions.sinceOnset.map(logRows);
  const noRem = params.transitions.sinceOnset.map((m) => logRows(withoutRem(m)));
  const logMoved = againstUsual(params.movement.p);
  const logCue = againstUsual(params.heartCue.p);
  return {
    emission(stage, f) {
      const { mean, sd } = params.hr[stage];
      const bin = params.movement.edgesDeg.filter((edge) => f.movementDeg >= edge).length;
      // Nothing says how awake looks in HRV, breathing or DFA: the lab data has no RR, and
      // moving smears the beats. So awake borrows light's levels, and RR can't tell them apart.
      const own = emissions[stage === "awake" ? "light" : stage];
      return (
        (f.arousal ? 0 : gaussian(f.hrZ, mean, sd)) +
        gaussian(f.hrvZ, own.hrvZ.mean, own.hrvZ.sd) +
        gaussian(f.breathingZ, own.breathingZ.mean, own.breathingZ.sd) +
        gaussian(f.dfaZ, own.dfaZ.mean, own.dfaZ.sd) +
        (logMoved[stage][bin] ?? 0) +
        (logCue[stage][heartCue(f)] ?? 0)
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

/** The live model: trained HR, movement and transitions, with your own emissions if fitted. */
export function stageModel(emissions: StageEmissions | undefined): StageModel {
  return emissions ? trainedModel(STAGE_PARAMS, emissions) : TRAINED;
}

/** log N(z; mean, sd) up to a constant shared by every state; null features add nothing. */
export function gaussian(z: number | null, mean: number, sd: number): number {
  return z === null ? 0 : -((z - mean) ** 2) / (2 * sd * sd) - Math.log(sd);
}

/** The matrix with no way into REM. */
function withoutRem(matrix: number[][]): number[][] {
  return matrix.map((row, from) => row.map((p, to) => (to === REM && from !== REM ? 0 : p)));
}

/**
 * log P(bin | stage) ÷ P(bin 0 | stage) for a sleep stage, where bin 0 is the usual (still, no
 * HR cue). Stillness is the norm in every sleep stage, and a night has hundreds of still epochs,
 * so scoring it would add up to a steady pull toward whichever stage is stillest (deep) whatever
 * the heart says; on held-out nights that cost accuracy and turned a featureless night deep. So
 * only a movement counts as evidence between them. Awake is against light's usual instead: being
 * still is real evidence against being awake.
 */
function againstUsual(p: Record<Stage, number[]>): Record<Stage, number[]> {
  const against = (v: number[], usual: number) => v.map((x) => Math.log(x / usual));
  return {
    awake: against(p.awake, p.light[0] ?? 1),
    light: against(p.light, p.light[0] ?? 1),
    deep: against(p.deep, p.deep[0] ?? 1),
    rem: against(p.rem, p.rem[0] ?? 1),
  };
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
  let scores = STATES.map((_, s) => startScore(model, s, features[0]));
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

/** The first epoch's score: sleep starts from wake or light, never straight into deep or REM. */
export function startScore(model: StageModel, state: number, f: EpochFeatures | undefined): number {
  return (
    emission(model, state, f) + (state === DEEP || state === REM ? Number.NEGATIVE_INFINITY : 0)
  );
}

/** The model's likelihood, except that before onset awake follows scoreEpochs exactly. */
export function emission(model: StageModel, state: number, f: EpochFeatures | undefined): number {
  const stage = STATES[state];
  if (!f || stage === undefined) {
    return Number.NEGATIVE_INFINITY;
  }
  if (afterOnset(f)) {
    return model.emission(stage, f);
  }
  if (f.asleep === (state === AWAKE)) {
    return Number.NEGATIVE_INFINITY;
  }
  return stage === "awake" ? 0 : model.emission(stage, f);
}

/** Onset and the window's end stay scoreEpochs' and sleep.ts's; awake is decoded in between. */
export function afterOnset(f: EpochFeatures): boolean {
  return f.sinceOnsetMin !== null && f.sinceOnsetMin >= 0;
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

export function isPlausible(lightMin: number, deepMin: number, remMin: number): boolean {
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
