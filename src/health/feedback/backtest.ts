// Replay past nights with two sets of weights and compare them, before anything changes.
//
// Two questions decide whether a re-fit is worth applying:
//   1. On mornings the fit never saw, does recovery agree better with how you felt?
//      (walk-forward: fit on everything before a week, score that week, repeat)
//   2. Does any day's recovery swing so much that the history would look rewritten?
// See docs/health-feedback.md.

import {
  BASELINE_NIGHTS,
  baselines,
  type NightSignals,
  recovery,
  recoveryTerms,
} from "../metrics/recovery";
import { rankCorrelation } from "../metrics/stats";
import type { RecoveryWeights } from "../params";
import { type RatedNight, refitWeights } from "./refit";

/** One stored night, oldest first, with the feel rating from that morning if there was one. */
export interface PastNight {
  date: string;
  signals: NightSignals;
  feel: number | null;
}

/** A re-fit must raise held-out agreement by at least this much to be proposed. */
export const MIN_GAIN = 0.05;
/** …and must not move any single day's recovery by more than this many points. */
export const MAX_DAY_SHIFT = 25;
export const HELD_OUT_WEEKS = 4;

/** Recovery for every night that has enough history, scored as the daily summary would. */
export function replay(nights: PastNight[], weights: RecoveryWeights): Map<string, number> {
  const scores = new Map<string, number>();
  nights.forEach((night, i) => {
    const r = recovery(night.signals, historyBefore(nights, i), weights);
    if (r) {
      scores.set(night.date, r.pct);
    }
  });
  return scores;
}

/**
 * The nights a daily summary for nights[i] would see: those in the 60 calendar days before it.
 * (Nights without data have no row, so this can be fewer than 60.)
 */
function historyBefore(nights: PastNight[], i: number): NightSignals[] {
  const date = nights[i]?.date;
  if (!date) {
    return [];
  }
  const first = Temporal.PlainDate.from(date).subtract({ days: BASELINE_NIGHTS }).toString();
  return nights
    .slice(0, i)
    .filter((n) => n.date >= first)
    .map((n) => n.signals);
}

/** Mornings with a feel rating, broken into recovery's terms, for re-fitting. */
export function ratedNights(nights: PastNight[]): RatedNight[] {
  const rated: RatedNight[] = [];
  nights.forEach((night, i) => {
    const base = baselines(historyBefore(nights, i));
    const terms = base ? recoveryTerms(night.signals, base) : null;
    if (terms && night.feel !== null) {
      rated.push({ terms, feel: night.feel });
    }
  });
  return rated;
}

export interface Shift {
  days: number;
  meanAbs: number;
  maxAbs: number;
  maxDate: string | null;
}

/** How much each day's recovery moves between two sets of weights. */
export function shift(nights: PastNight[], before: RecoveryWeights, after: RecoveryWeights): Shift {
  const a = replay(nights, before);
  const b = replay(nights, after);
  let total = 0;
  let maxAbs = 0;
  let maxDate: string | null = null;
  for (const [date, pct] of a) {
    const delta = Math.abs((b.get(date) ?? pct) - pct);
    total += delta;
    if (delta > maxAbs) {
      maxAbs = delta;
      maxDate = date;
    }
  }
  return { days: a.size, meanAbs: a.size > 0 ? total / a.size : 0, maxAbs, maxDate };
}

export interface HeldOut {
  /** Rated mornings that were scored without being fitted on. */
  mornings: number;
  /** Rank correlation of recovery with feel on those mornings. */
  current: number | null;
  refit: number | null;
}

/**
 * Walk forward over the last `weeks` weeks: for each, re-fit on the nights before it and score
 * the week with both the current and the re-fitted weights.
 */
export function walkForward(
  nights: PastNight[],
  current: RecoveryWeights,
  weeks = HELD_OUT_WEEKS,
): HeldOut {
  const pairs = { feel: [] as number[], current: [] as number[], refit: [] as number[] };
  for (let w = weeks; w >= 1; w--) {
    const cut = nights.length - 7 * w;
    if (cut <= 0) {
      continue;
    }
    const fitted = refitWeights(ratedNights(nights.slice(0, cut)), current).weights;
    const week = new Set(nights.slice(cut, cut + 7).map((n) => n.date));
    scoreWeek(nights.slice(0, cut + 7), week, current, fitted, pairs);
  }
  return {
    mornings: pairs.feel.length,
    current: rankCorrelation(pairs.current, pairs.feel),
    refit: rankCorrelation(pairs.refit, pairs.feel),
  };
}

function scoreWeek(
  nights: PastNight[],
  week: Set<string>,
  current: RecoveryWeights,
  fitted: RecoveryWeights,
  pairs: { feel: number[]; current: number[]; refit: number[] },
): void {
  const a = replay(nights, current);
  const b = replay(nights, fitted);
  for (const night of nights) {
    const before = a.get(night.date);
    const after = b.get(night.date);
    if (
      week.has(night.date) &&
      night.feel !== null &&
      before !== undefined &&
      after !== undefined
    ) {
      pairs.feel.push(night.feel);
      pairs.current.push(before);
      pairs.refit.push(after);
    }
  }
}

/** Whether a re-fit earned its place: better on unseen mornings, and no wild swings. */
export function worthApplying(heldOut: HeldOut, moved: Shift): boolean {
  if (heldOut.refit === null) {
    return false;
  }
  const gain = heldOut.refit - (heldOut.current ?? 0);
  return gain >= MIN_GAIN && moved.maxAbs <= MAX_DAY_SHIFT;
}
