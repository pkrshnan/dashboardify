// Fit the sleep stages to your nights, then hold the result to guardrails before it can be
// applied, as recovery's re-fit is. EM itself is in stage-em.ts. See docs/health-feedback.md.

import type { EpochFeatures } from "../metrics/sleep-features";
import {
  FITTED_FEATURES,
  type FittedFeature,
  type SleepStage,
  type StageEmissions,
  sleepStages,
  stageModel,
} from "../metrics/sleep-stages";
import { type EmFit, fitEmissions, logLikelihood } from "./stage-em";

export interface StageNight {
  date: string;
  features: EpochFeatures[];
}

/**
 * No fit before this many nights. Each feature is z-scored within its night, so a night says
 * only how it splits its own epochs; five give some 4,000 asleep epochs, several hundred even
 * for the rarest stage, enough to outweigh the 200-epoch prior, and no one odd night is more
 * than a fifth of the data.
 */
export const MIN_NIGHTS = 5;
/**
 * The most any mean may move in one apply, in night SDs: well under the hand-set gaps between
 * stages (0.6–1.4), so a fit has to hold over more than one apply to move a stage far.
 */
export const MAX_MEAN_STEP = 0.5;
/** At least this share of the fitting nights must decode to plausible shares. */
export const MIN_PLAUSIBLE = 0.75;

/** What the literature fixes, which a fit may not turn round (Penzel 2003; Fonseca 2017). */
const ORDER: { key: FittedFeature; low: SleepStage; high: SleepStage }[] = [
  { key: "dfaZ", low: "deep", high: "light" },
  { key: "dfaZ", low: "light", high: "rem" },
  { key: "hrvZ", low: "rem", high: "deep" },
  { key: "breathingZ", low: "rem", high: "deep" },
];

export type Guardrail = "nights" | "order" | "plausible";

export interface Shares {
  light: number;
  deep: number;
  rem: number;
  plausible: boolean;
}

export interface StageFit {
  /** Empty when the fit may be applied. */
  failed: Guardrail[];
  nights: number;
  current: StageEmissions;
  /** After the step cap; equal to `current` when there were too few nights. */
  fitted: StageEmissions;
  em: EmFit | null;
  /** The log-likelihood with the capped emissions, which may be under EM's own. */
  logLik: number | null;
  /** Means held to MAX_MEAN_STEP, as "deep dfaZ". */
  capped: string[];
  /** Orderings the fit broke, as "dfaZ deep < light". */
  disordered: string[];
  perNight: { date: string; before: Shares | null; after: Shares | null }[];
  plausibleBefore: number;
  plausibleAfter: number;
}

export function fitStages(nights: StageNight[], current: StageEmissions): StageFit {
  const before = nights.map((n) => nightShares(n.features, current));
  const base = { nights: nights.length, current, plausibleBefore: plausibleCount(before) };
  if (nights.length < MIN_NIGHTS) {
    return {
      ...base,
      failed: ["nights"],
      fitted: current,
      em: null,
      logLik: null,
      capped: [],
      disordered: [],
      perNight: nights.map((n, i) => ({ date: n.date, before: before[i] ?? null, after: null })),
      plausibleAfter: 0,
    };
  }
  const features = nights.map((n) => n.features);
  const em = fitEmissions(features, current);
  const { emissions: fitted, capped } = capSteps(em.emissions, current);
  const after = nights.map((n) => nightShares(n.features, fitted));
  const disordered = outOfOrder(fitted);
  const plausibleAfter = plausibleCount(after);
  return {
    ...base,
    failed: failedGuardrails(disordered, plausibleAfter, nights.length),
    fitted,
    em,
    logLik: logLikelihood(features, fitted),
    capped,
    disordered,
    perNight: nights.map((n, i) => ({
      date: n.date,
      before: before[i] ?? null,
      after: after[i] ?? null,
    })),
    plausibleAfter,
  };
}

function failedGuardrails(disordered: string[], plausible: number, nights: number): Guardrail[] {
  const failed: Guardrail[] = [];
  if (disordered.length > 0) {
    failed.push("order");
  }
  if (plausible < MIN_PLAUSIBLE * nights) {
    failed.push("plausible");
  }
  return failed;
}

/** Each mean within MAX_MEAN_STEP of the current one; values rounded for the params file. */
export function capSteps(
  fitted: StageEmissions,
  current: StageEmissions,
): { emissions: StageEmissions; capped: string[] } {
  const capped: string[] = [];
  const one = (stage: SleepStage) => {
    const entries = FITTED_FEATURES.map((k) => {
      const now = current[stage][k].mean;
      const mean = clamp(fitted[stage][k].mean, now - MAX_MEAN_STEP, now + MAX_MEAN_STEP);
      if (mean !== fitted[stage][k].mean) {
        capped.push(`${stage} ${k}`);
      }
      return [k, { mean: round3(mean), sd: round3(fitted[stage][k].sd) }];
    });
    return Object.fromEntries(entries) as StageEmissions[SleepStage];
  };
  return { emissions: { light: one("light"), deep: one("deep"), rem: one("rem") }, capped };
}

/** The orderings in ORDER that `emissions` breaks. */
export function outOfOrder(emissions: StageEmissions): string[] {
  return ORDER.filter(
    ({ key, low, high }) => emissions[low][key].mean >= emissions[high][key].mean,
  ).map(({ key, low, high }) => `${key} ${low} < ${high}`);
}

function nightShares(features: EpochFeatures[], emissions: StageEmissions): Shares | null {
  const stages = sleepStages(features, stageModel(emissions));
  if (!stages) {
    return null;
  }
  const asleep = stages.lightMin + stages.deepMin + stages.remMin;
  return {
    light: stages.lightMin / asleep,
    deep: stages.deepMin / asleep,
    rem: stages.remMin / asleep,
    plausible: stages.plausible,
  };
}

function plausibleCount(shares: (Shares | null)[]): number {
  return shares.filter((s) => s?.plausible).length;
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
