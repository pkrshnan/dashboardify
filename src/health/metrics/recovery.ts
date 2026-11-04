// Recovery: how far last night's signals sit from your own normal, rolled into one percentage.
// Every input is a z-score against your last 60 nights, so it compares you only with yourself.
// See docs/health-metrics.md.

import { DEFAULT_PARAMS, type RecoveryWeights } from "../params";
import { mean, normalCdf, sd } from "./stats";

/** The overnight values recovery is built from. Any of them can be missing. */
export interface NightSignals {
  lnRmssd: number | null;
  restingHr: number | null;
  breathingRate: number | null;
  skinTemp: number | null;
  sleepScore: number | null;
}

/** Recovery needs two weeks of nights before "normal" means anything. */
export const MIN_BASELINE_NIGHTS = 14;
export const BASELINE_NIGHTS = 60;
/** Skin temperature is compared with a shorter, 30-night normal (seasons and bedding drift). */
const TEMP_BASELINE_NIGHTS = 30;
const MIN_TEMP_NIGHTS = 7;

/** Breathing counts only past +1 SD; temperature only past +0.3 °C, 0.5 per °C beyond that. */
const BREATHING_FREE_Z = 1;
const TEMP_FREE_C = 0.3;
const TEMP_PENALTY_PER_C = 0.5;
/** Floor for the spread of c, so a very steady history can't blow small changes up. */
const MIN_SPREAD = 0.1;

export interface Baseline {
  mean: number;
  sd: number;
}

/** Mean and SD of a metric over earlier nights. Null if there aren't enough. */
export function baseline(values: (number | null)[], minCount: number): Baseline | null {
  const present = values.filter((v): v is number => v !== null);
  const m = mean(present);
  const s = sd(present);
  if (present.length < minCount || m === null || s === null || s === 0) {
    return null;
  }
  return { mean: m, sd: s };
}

export function zScore(value: number | null, base: Baseline | null): number | null {
  if (value === null || base === null) {
    return null;
  }
  return (value - base.mean) / base.sd;
}

/** Tonight's skin temperature minus the mean of the last 30 nights. */
export function tempDeviation(tonight: number | null, history: NightSignals[]): number | null {
  const recent = history.slice(-TEMP_BASELINE_NIGHTS).map((n) => n.skinTemp);
  const present = recent.filter((v): v is number => v !== null);
  const m = mean(present);
  if (tonight === null || m === null || present.length < MIN_TEMP_NIGHTS) {
    return null;
  }
  return tonight - m;
}

export interface Baselines {
  hrv: Baseline;
  rhr: Baseline;
  breathing: Baseline | null;
  sleep: Baseline | null;
}

/** Your normal for each signal over the 60 nights in `history`, or null before 14 nights. */
export function baselines(history: NightSignals[]): Baselines | null {
  const recent = history.slice(-BASELINE_NIGHTS);
  const hrv = baseline(
    recent.map((n) => n.lnRmssd),
    MIN_BASELINE_NIGHTS,
  );
  const rhr = baseline(
    recent.map((n) => n.restingHr),
    MIN_BASELINE_NIGHTS,
  );
  if (!(hrv && rhr)) {
    return null;
  }
  const breathing = baseline(
    recent.map((n) => n.breathingRate),
    MIN_BASELINE_NIGHTS,
  );
  const sleep = baseline(
    recent.map((n) => n.sleepScore),
    MIN_BASELINE_NIGHTS,
  );
  return { hrv, rhr, breathing, sleep };
}

/**
 * Each signal's contribution before weighting, signed so that positive is good: z-scores for HRV
 * and sleep, the negative z-score for resting HR, and a penalty for breathing past +1 SD. The
 * feedback loop fits the weights against these same terms.
 */
export type RecoveryTerms = RecoveryWeights;

export function recoveryTerms(night: NightSignals, base: Baselines): RecoveryTerms | null {
  const zHrv = zScore(night.lnRmssd, base.hrv);
  const zRhr = zScore(night.restingHr, base.rhr);
  if (zHrv === null || zRhr === null) {
    return null;
  }
  const zBreathing = zScore(night.breathingRate, base.breathing) ?? 0;
  return {
    hrv: zHrv,
    rhr: -zRhr,
    sleep: zScore(night.sleepScore, base.sleep) ?? 0,
    breathing: -Math.max(0, zBreathing - BREATHING_FREE_Z),
  };
}

/** The combined score c: positive is better than your normal, negative worse. */
function combined(
  night: NightSignals,
  base: Baselines,
  weights: RecoveryWeights,
  tempDev: number | null,
): number | null {
  const t = recoveryTerms(night, base);
  if (!t) {
    return null;
  }
  const tempPenalty = TEMP_PENALTY_PER_C * Math.max(0, (tempDev ?? 0) - TEMP_FREE_C);
  const weighted =
    weights.hrv * t.hrv +
    weights.rhr * t.rhr +
    weights.sleep * t.sleep +
    weights.breathing * t.breathing;
  return weighted - tempPenalty;
}

export interface Recovery {
  /** 0–100: the share of your normal nights this one beats. */
  pct: number;
  /** The weighted sum before it becomes a percentage, for the curious. */
  score: number;
}

/**
 * Recovery = 100 × Φ(c / σc), where σc is how much c usually varies for you. An ordinary night
 * lands near 50%. `history` is earlier nights, oldest first, not including tonight.
 */
export function recovery(
  night: NightSignals,
  history: NightSignals[],
  weights: RecoveryWeights = DEFAULT_PARAMS.recovery,
): Recovery | null {
  const base = baselines(history);
  if (!base) {
    return null;
  }
  const c = combined(night, base, weights, tempDeviation(night.skinTemp, history));
  if (c === null) {
    return null;
  }
  const past = history
    .slice(-BASELINE_NIGHTS)
    .map((n) => combined(n, base, weights, null))
    .filter((v): v is number => v !== null);
  const spread = Math.max(MIN_SPREAD, sd(past) ?? 1);
  return { pct: 100 * normalCdf(c / spread), score: c };
}
