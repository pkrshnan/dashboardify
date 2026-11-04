// Re-fit recovery's weights against how you said you felt each morning.
//
// Ridge regression pulled toward the current weights: with little data the weights barely move,
// and only a consistent pattern over many mornings can shift them. Feel is only ever the target
// here, never an input to recovery, so recovery can't turn into a mirror of your mood.
// See docs/health-feedback.md.

import type { RecoveryTerms } from "../metrics/recovery";
import { mean, solveLinear } from "../metrics/stats";
import { type RecoveryWeights, WEIGHT_KEYS } from "../params";

/** One morning with both a recovery breakdown and a feel rating. */
export interface RatedNight {
  terms: RecoveryTerms;
  feel: number;
}

/** No re-fit before this many rated mornings. */
export const MIN_RATED = 30;
/** How strongly the current weights hold: worth this many mornings of evidence. */
export const PRIOR_STRENGTH = 30;
/** The most any one weight may move in one re-fit. */
export const MAX_STEP = 0.1;

export type Refit =
  | { status: "fitted"; weights: RecoveryWeights; rated: number }
  | { status: "not-enough-data" | "no-signal"; weights: RecoveryWeights; rated: number };

export function refitWeights(nights: RatedNight[], current: RecoveryWeights): Refit {
  const rated = nights.length;
  if (rated < MIN_RATED) {
    return { status: "not-enough-data", weights: current, rated };
  }
  const x = centered(nights.map((n) => WEIGHT_KEYS.map((k) => n.terms[k])));
  const y = centeredColumn(nights.map((n) => n.feel));
  const prior = WEIGHT_KEYS.map((k) => current[k]);
  const scale = priorScale(x, y, prior);
  if (scale === null) {
    return { status: "no-signal", weights: current, rated };
  }
  const fitted = ridge(
    x,
    y,
    prior.map((w) => w * scale),
  );
  if (!fitted) {
    return { status: "no-signal", weights: current, rated };
  }
  return { status: "fitted", weights: guard(fitted, current), rated };
}

/**
 * The current weights are in "recovery units"; the fit is in "feel units". Recovery only cares
 * about the weights' ratios, so the prior is the current weights scaled to fit feel as well as
 * they can on their own. Null when they don't predict feel at all (or predict it backwards).
 */
function priorScale(x: number[][], y: number[], prior: number[]): number | null {
  const predicted = x.map((row) => dot(row, prior));
  const fit = dot(predicted, y);
  const size = dot(predicted, predicted);
  return fit > 0 && size > 0 ? fit / size : null;
}

/** w = (XᵀX + λI)⁻¹ (Xᵀy + λ·prior) */
function ridge(x: number[][], y: number[], prior: number[]): number[] | null {
  const k = prior.length;
  const a = Array.from({ length: k }, (_, i) =>
    Array.from({ length: k }, (_, j) => {
      const xtx = x.reduce((sum, row) => sum + (row[i] ?? 0) * (row[j] ?? 0), 0);
      return xtx + (i === j ? PRIOR_STRENGTH : 0);
    }),
  );
  const b = prior.map(
    (p, i) => x.reduce((sum, row, t) => sum + (row[i] ?? 0) * (y[t] ?? 0), 0) + PRIOR_STRENGTH * p,
  );
  return solveLinear(a, b);
}

/**
 * Back to recovery units and inside the guardrails: no negative weights, the same total as now,
 * and no weight more than MAX_STEP from where it was.
 */
function guard(fitted: number[], current: RecoveryWeights): RecoveryWeights {
  const total = WEIGHT_KEYS.reduce((sum, k) => sum + current[k], 0);
  const positive = fitted.map((w) => Math.max(0, w));
  const sum = positive.reduce((s, w) => s + w, 0) || 1;
  let stepped = positive.map((w) => (w * total) / sum);
  // Clamping can break the total and rescaling can break the clamp, so alternate until both hold.
  for (let pass = 0; pass < 50; pass++) {
    stepped = WEIGHT_KEYS.map((k, i) =>
      clamp(stepped[i] ?? 0, Math.max(0, current[k] - MAX_STEP), current[k] + MAX_STEP),
    );
    const gap = total - stepped.reduce((s, w) => s + w, 0);
    if (Math.abs(gap) < 1e-9) {
      break;
    }
    // Spread the gap over the weights that still have room to move that way.
    const free = WEIGHT_KEYS.filter((k, i) =>
      gap > 0
        ? (stepped[i] ?? 0) < current[k] + MAX_STEP
        : (stepped[i] ?? 0) > Math.max(0, current[k] - MAX_STEP),
    );
    stepped = stepped.map((w, i) => {
      const k = WEIGHT_KEYS[i];
      return k && free.includes(k) ? w + gap / free.length : w;
    });
  }
  const weights = stepped.map(round3);
  return {
    hrv: weights[0] ?? 0,
    rhr: weights[1] ?? 0,
    sleep: weights[2] ?? 0,
    breathing: weights[3] ?? 0,
  };
}

function centered(rows: number[][]): number[][] {
  const width = rows[0]?.length ?? 0;
  const means = Array.from({ length: width }, (_, j) => mean(rows.map((r) => r[j] ?? 0)) ?? 0);
  return rows.map((r) => r.map((v, j) => v - (means[j] ?? 0)));
}

function centeredColumn(values: number[]): number[] {
  const m = mean(values) ?? 0;
  return values.map((v) => v - m);
}

function dot(a: number[], b: number[]): number {
  return a.reduce((sum, v, i) => sum + v * (b[i] ?? 0), 0);
}

function clamp(v: number, lo: number, hi: number): number {
  return Math.min(hi, Math.max(lo, v));
}

function round3(v: number): number {
  return Math.round(v * 1000) / 1000;
}
