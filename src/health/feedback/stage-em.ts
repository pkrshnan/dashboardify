// Fitting the sleep stages' HRV, breathing and DFA α1 Gaussians to your own nights by EM
// (Baum–Welch), with everything else in the model held at its trained values.
//
// No night has labels, so each round asks the full current model how likely each epoch is to be
// each stage (forward–backward), then re-estimates the three features' means and SDs from those
// weighted epochs. HR, movement, transitions and the time of night stay as sleep-lab nights
// trained them (H12), which is what keeps "deep" meaning deep while the rest moves.
// See docs/health-feedback.md.

import type { EpochFeatures } from "../metrics/sleep-features";
import {
  detrendHr,
  emission,
  epochTime,
  FITTED_FEATURES,
  type FittedFeature,
  type Gaussian,
  SLEEP_STAGES,
  STAGE_PARAMS,
  STATES,
  type StageEmissions,
  type StageModel,
  startScore,
  trainedModel,
} from "../metrics/sleep-stages";

/**
 * The current values count as this many epochs of evidence for every mean and SD: 100 minutes,
 * about one night's deep sleep. One odd night can move a stage at most about halfway, while a
 * week of nights (some 1,000 epochs of each stage) outweighs it five to one. The same idea as
 * the 100 epochs each transition bin leans on in staging/fit.ts.
 */
export const PRIOR_EPOCHS = 200;
/**
 * No SD below this, during the fit and after. A feature z-scored per night has SD 1 over the
 * night; a stage narrower than a third of that would mean the fit has wrapped itself around a
 * handful of epochs, and any epoch outside it would be all but ruled out of that stage.
 */
export const SD_FLOOR = 0.3;
/** Stop once a round adds less log-likelihood than this, in nats over all nights. */
const TOLERANCE = 0.01;
const MAX_ITERATIONS = 200;

export interface Posteriors {
  /** P(state | the whole night) per epoch, in STATES order. */
  gamma: number[][];
  /** log P(the night's features), up to a constant shared by every model. */
  logLik: number;
}

export interface EmFit {
  emissions: StageEmissions;
  /** Summed over the nights: at the start, and with the fitted emissions. */
  logLik: { start: number; end: number };
  iterations: number;
  converged: boolean;
  /** Stage-feature pairs held up by SD_FLOOR, as "deep dfaZ". */
  floored: string[];
}

/** Forward–backward in log space over a night already detrended as sleepStages does. */
export function posteriors(features: EpochFeatures[], model: StageModel): Posteriors {
  const steps = features.map((_, i) => (i > 0 ? model.transitions(epochTime(features, i)) : []));
  const emit = features.map((f) => STATES.map((_, s) => emission(model, s, f)));
  const alpha = forward(features, model, steps, emit);
  const beta = backward(steps, emit);
  const logLik = logSumExp(alpha[alpha.length - 1] ?? []);
  const gamma = alpha.map((row, i) =>
    row.map((a, s) => Math.exp(a + (beta[i]?.[s] ?? 0) - logLik)),
  );
  return { gamma, logLik };
}

function forward(
  features: EpochFeatures[],
  model: StageModel,
  steps: number[][][],
  emit: number[][],
): number[][] {
  const alpha = [STATES.map((_, s) => startScore(model, s, features[0]))];
  for (let i = 1; i < features.length; i++) {
    const prev = alpha[i - 1] ?? [];
    const step = steps[i] ?? [];
    alpha.push(
      STATES.map(
        (_, to) =>
          logSumExp(prev.map((a, from) => a + (step[from]?.[to] ?? 0))) + (emit[i]?.[to] ?? 0),
      ),
    );
  }
  return alpha;
}

function backward(steps: number[][][], emit: number[][]): number[][] {
  const n = emit.length;
  const beta: number[][] = new Array(n);
  beta[n - 1] = STATES.map(() => 0);
  for (let i = n - 2; i >= 0; i--) {
    const next = beta[i + 1] ?? [];
    const step = steps[i + 1] ?? [];
    beta[i] = STATES.map((_, from) =>
      logSumExp(next.map((b, to) => (step[from]?.[to] ?? 0) + (emit[i + 1]?.[to] ?? 0) + b)),
    );
  }
  return beta;
}

function logSumExp(values: number[]): number {
  const top = Math.max(...values);
  if (top === Number.NEGATIVE_INFINITY) {
    return top;
  }
  return top + Math.log(values.reduce((sum, v) => sum + Math.exp(v - top), 0));
}

/** EM from `prior` (the live emissions), which the MAP updates also lean on. */
export function fitEmissions(nights: EpochFeatures[][], prior: StageEmissions): EmFit {
  const prepared = nights.map(detrendHr);
  let emissions = prior;
  let round = expectation(prepared, emissions);
  const start = round.logLik;
  let iterations = 0;
  let converged = false;
  while (iterations < MAX_ITERATIONS && !converged) {
    const next = maximisation(prepared, round.gammas, prior);
    const nextRound = expectation(prepared, next);
    iterations++;
    converged = nextRound.logLik - round.logLik < TOLERANCE;
    emissions = next;
    round = nextRound;
  }
  return {
    emissions,
    logLik: { start, end: round.logLik },
    iterations,
    converged,
    floored: flooredPairs(emissions),
  };
}

/** The log-likelihood of `nights` (detrended) under `emissions`, with each night's posteriors. */
function expectation(nights: EpochFeatures[][], emissions: StageEmissions) {
  const model = trainedModel(STAGE_PARAMS, emissions);
  const passes = nights.map((features) => posteriors(features, model));
  return {
    gammas: passes.map((p) => p.gamma),
    logLik: passes.reduce((sum, p) => sum + p.logLik, 0),
  };
}

/** The log-likelihood of raw (not yet detrended) nights under `emissions`. */
export function logLikelihood(nights: EpochFeatures[][], emissions: StageEmissions): number {
  return expectation(nights.map(detrendHr), emissions).logLik;
}

function maximisation(
  nights: EpochFeatures[][],
  gammas: number[][][],
  prior: StageEmissions,
): StageEmissions {
  const one = (stage: (typeof SLEEP_STAGES)[number]) => {
    const state = STATES.indexOf(stage);
    const fitted = FITTED_FEATURES.map((k) => [
      k,
      update(nights, gammas, state, k, prior[stage][k]),
    ]);
    return Object.fromEntries(fitted) as Record<FittedFeature, Gaussian>;
  };
  return { light: one("light"), deep: one("deep"), rem: one("rem") };
}

/**
 * The MAP mean and SD under a normal–inverse-χ² prior worth PRIOR_EPOCHS epochs drawn from
 * `prior`: as if that many extra epochs sat at the prior's mean with the prior's spread.
 */
function update(
  nights: EpochFeatures[][],
  gammas: number[][][],
  state: number,
  key: FittedFeature,
  prior: Gaussian,
): Gaussian {
  const points = weighted(nights, gammas, state, key);
  const n = points.reduce((sum, p) => sum + p.w, 0);
  const total = PRIOR_EPOCHS + n;
  const mean = (PRIOR_EPOCHS * prior.mean + points.reduce((sum, p) => sum + p.w * p.x, 0)) / total;
  const spread =
    PRIOR_EPOCHS * (prior.sd ** 2 + (prior.mean - mean) ** 2) +
    points.reduce((sum, p) => sum + p.w * (p.x - mean) ** 2, 0);
  return { mean, sd: Math.max(SD_FLOOR, Math.sqrt(spread / total)) };
}

/** Each epoch's value of `key` with its weight for `state`; null values are left out. */
function weighted(
  nights: EpochFeatures[][],
  gammas: number[][][],
  state: number,
  key: FittedFeature,
): { x: number; w: number }[] {
  return nights.flatMap((features, n) =>
    features.flatMap((f, i) => {
      const x = f[key];
      const w = gammas[n]?.[i]?.[state] ?? 0;
      return x === null || w === 0 ? [] : [{ x, w }];
    }),
  );
}

function flooredPairs(emissions: StageEmissions): string[] {
  return SLEEP_STAGES.flatMap((stage) =>
    FITTED_FEATURES.filter((k) => emissions[stage][k].sd <= SD_FLOOR).map((k) => `${stage} ${k}`),
  );
}
