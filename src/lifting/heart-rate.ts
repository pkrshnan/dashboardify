// What the strap says about a session: how long you rested between sets and how hard each set
// pushed your heart. Both come from the day's sets already matched to HR climbs (the derived
// `sets` rows written by the daily summary), so a day whose sets weren't matched has neither.

import type { DerivedRow } from "../health/derived-store";
import { exerciseKey } from "./names";

export interface SessionHeartRate {
  /** The median gap from one set's peak to the next set's start. */
  restSeconds: number | null;
  /** The mean peak HR of the working sets. */
  peakHr: number | null;
}

/** The HR of `key`'s sets in a day's set rows; null when none of them were matched. */
export function sessionHeartRate(rows: DerivedRow[], key: string): SessionHeartRate | null {
  const sets = rows
    .filter((r) => exerciseKey(String(r.exercise)) === key && typeof r.peak_ts === "number")
    .sort((a, b) => Number(a.peak_ts) - Number(b.peak_ts));
  if (sets.length === 0) {
    return null;
  }
  const working = sets.filter((r) => r.warm_up !== 1);
  const peaks = working.flatMap((r) => (typeof r.peak_hr === "number" ? [r.peak_hr] : []));
  return {
    restSeconds: median(rests(sets)),
    peakHr: peaks.length > 0 ? Math.round(peaks.reduce((a, b) => a + b, 0) / peaks.length) : null,
  };
}

function rests(sets: DerivedRow[]): number[] {
  return sets.slice(1).flatMap((set, i) => {
    const before = sets[i];
    const gap = Number(set.start_ts) - Number(before?.peak_ts);
    return typeof set.start_ts === "number" && gap > 0 ? [Math.round(gap / 1000)] : [];
  });
}

function median(values: number[]): number | null {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length === 0) {
    return null;
  }
  return sorted.length % 2 === 1
    ? (sorted[mid] ?? null)
    : Math.round(((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2);
}
