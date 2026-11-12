// Scoring a stage model against the sleep lab: leave one subject out, pool the held-out epochs,
// and report what a reviewer needs to judge it.

import { EPOCH_MS } from "../metrics/sleep-epochs";
import type { EpochFeatures } from "../metrics/sleep-features";
import {
  type SleepStage,
  STATES,
  type Stage,
  type StageModel,
  sleepStages,
} from "../metrics/sleep-stages";
import { mean, sd } from "../metrics/stats";
import type { LabelledNight } from "./walch";

const Z_95 = 1.96;

export interface HeldOutNight {
  id: string;
  truth: (Stage | null)[];
  predicted: Stage[];
}

/** Decode each night with a model that never saw it. */
export function leaveOneOut(
  nights: LabelledNight[],
  modelWithout: (others: LabelledNight[]) => StageModel,
): HeldOutNight[] {
  return nights.map((night) => {
    const model = modelWithout(nights.filter((n) => n !== night));
    const predicted =
      sleepStages(night.features, model)?.stages ?? night.features.map(() => "awake");
    return { id: night.id, truth: night.truth, predicted };
  });
}

/**
 * A model decoded as H12–H14 did: scoreEpochs' awake all night, so the model only splits its
 * asleep epochs. Kept to score the decoded awake against.
 */
export function fixedAwake(model: {
  emission(stage: SleepStage, f: EpochFeatures): number;
  transitions(t: number): number[][];
}): StageModel {
  return {
    emission(stage, f) {
      if (f.asleep === (stage === "awake")) {
        return Number.NEGATIVE_INFINITY;
      }
      return stage === "awake" ? 0 : model.emission(stage, f);
    },
    transitions: (t) => model.transitions(t),
  };
}

/** confusion[true][predicted], in STATES order, over the epochs the lab scored. */
export function confusion(
  nights: HeldOutNight[],
  classes: (s: Stage) => number = stateIndex,
): number[][] {
  const size = Math.max(...STATES.map(classes)) + 1;
  const matrix = Array.from({ length: size }, () => new Array<number>(size).fill(0));
  for (const night of nights) {
    night.truth.forEach((t, i) => {
      const p = night.predicted[i];
      const row = t === null ? undefined : matrix[classes(t)];
      if (row && p !== undefined) {
        row[classes(p)] = (row[classes(p)] ?? 0) + 1;
      }
    });
  }
  return matrix;
}

function stateIndex(s: Stage): number {
  return STATES.indexOf(s);
}

/** Wake, NREM, REM: the classes Walch 2019 reports. */
export function threeClass(s: Stage): number {
  if (s === "awake") {
    return 0;
  }
  return s === "rem" ? 2 : 1;
}

export function accuracy(matrix: number[][]): number {
  const total = sum(matrix.flat());
  return total > 0 ? sum(matrix.map((row, i) => row[i] ?? 0)) / total : 0;
}

/** Cohen's kappa: agreement beyond what the two sets of shares would give by chance. */
export function kappa(matrix: number[][]): number {
  const total = sum(matrix.flat());
  if (total === 0) {
    return 0;
  }
  const observed = accuracy(matrix);
  const chance = matrix.reduce((acc, row, i) => {
    const column = sum(matrix.map((r) => r[i] ?? 0));
    return acc + (sum(row) / total) * (column / total);
  }, 0);
  return chance < 1 ? (observed - chance) / (1 - chance) : 0;
}

/** Of each true class, the share predicted as it. */
export function recall(matrix: number[][]): number[] {
  return matrix.map((row, i) => (sum(row) > 0 ? (row[i] ?? 0) / sum(row) : 0));
}

/** Light, deep and REM as shares of the night's asleep epochs. */
export function shares(stages: (Stage | null)[]): Record<SleepStage, number> {
  const asleep = stages.filter((s) => s !== null && s !== "awake").length;
  const share = (stage: SleepStage) =>
    asleep > 0 ? stages.filter((s) => s === stage).length / asleep : 0;
  return { light: share("light"), deep: share("deep"), rem: share("rem") };
}

export interface WakeBouts {
  /** Runs of awake between the first and last sleep epoch, per night. */
  bouts: number;
  /** Of those, runs of a minute or less. */
  short: number;
  /** Minutes awake between the first and last sleep epoch, per night. */
  wasoMin: number;
}

/** Wake bouts per night, averaged; `pick` chooses the lab's stages or the model's. */
export function wakeBouts(
  nights: HeldOutNight[],
  pick: (n: HeldOutNight) => (Stage | null)[],
): WakeBouts {
  const per = nights.map((n) => boutsOf(pick(n)));
  const average = (k: keyof WakeBouts) => mean(per.map((p) => p[k])) ?? 0;
  return { bouts: average("bouts"), short: average("short"), wasoMin: average("wasoMin") };
}

function boutsOf(stages: (Stage | null)[]): WakeBouts {
  const isSleep = (s: Stage | null) => s !== null && s !== "awake";
  const first = stages.findIndex(isSleep);
  const last = stages.length - 1 - [...stages].reverse().findIndex(isSleep);
  const runs: number[] = [];
  let run = 0;
  for (const s of first === -1 ? [] : [...stages.slice(first, last + 1), null]) {
    if (s === "awake") {
      run++;
    } else if (run > 0) {
      runs.push(run);
      run = 0;
    }
  }
  const epochs = runs.reduce((acc, r) => acc + r, 0);
  return {
    bouts: runs.length,
    short: runs.filter((r) => r * EPOCH_MS <= 60_000).length,
    wasoMin: (epochs * EPOCH_MS) / 60_000,
  };
}

export interface Scores {
  accuracy: number;
  kappa: number;
  kappa3: number;
  meanNightKappa: number;
  recall: number[];
  /** Of the lab's sleep epochs, the share not called awake. Wake sensitivity is recall[0]. */
  wakeSpecificity: number;
  predicted: Record<SleepStage, number>;
  truth: Record<SleepStage, number>;
}

export function score(nights: HeldOutNight[]): Scores {
  const matrix = confusion(nights);
  const average = (pick: (n: HeldOutNight) => Record<SleepStage, number>, stage: SleepStage) =>
    mean(nights.map((n) => pick(n)[stage])) ?? 0;
  const both = (pick: (n: HeldOutNight) => Record<SleepStage, number>) => ({
    light: average(pick, "light"),
    deep: average(pick, "deep"),
    rem: average(pick, "rem"),
  });
  return {
    accuracy: accuracy(matrix),
    kappa: kappa(matrix),
    kappa3: kappa(confusion(nights, threeClass)),
    meanNightKappa: mean(nights.map((n) => kappa(confusion([n])))) ?? 0,
    recall: recall(matrix),
    wakeSpecificity: specificity(matrix, 0),
    predicted: both((n) => shares(n.predicted)),
    truth: both((n) => shares(n.truth)),
  };
}

/**
 * Bounds that hold 95% of held-out nights' predicted shares: mean ± 1.96 SD, widened to whole
 * percent. With 20-odd nights, the empirical 2.5th and 97.5th percentiles would just be the two
 * most extreme nights. Only nights with at least `minAsleepMin` asleep count: a short lab night
 * has no late REM.
 */
export function plausibleBounds(
  nights: HeldOutNight[],
  minAsleepMin: number,
): Record<SleepStage, number[]> {
  const long = nights.filter(
    (n) => (n.predicted.filter((s) => s !== "awake").length * EPOCH_MS) / 60_000 >= minAsleepMin,
  );
  const bounds = (stage: SleepStage) => {
    const values = long.map((n) => shares(n.predicted)[stage]);
    const m = mean(values) ?? 0;
    const spread = Z_95 * (sd(values) ?? 0);
    return [
      Math.max(0, Math.floor(100 * (m - spread)) / 100),
      Math.min(1, Math.ceil(100 * (m + spread)) / 100),
    ];
  };
  return { light: bounds("light"), deep: bounds("deep"), rem: bounds("rem") };
}

function specificity(matrix: number[][], cls: number): number {
  const others = matrix.filter((_, i) => i !== cls);
  const total = sum(others.flat());
  return total > 0 ? 1 - sum(others.map((row) => row[cls] ?? 0)) / total : 0;
}

function sum(values: number[]): number {
  return values.reduce((acc, v) => acc + v, 0);
}
