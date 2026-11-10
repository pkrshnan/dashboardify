// Training load: the last week's effort against the last four weeks', from each day's TRIMP.
// TRIMP, not strain, because strain is squashed and can't be summed or averaged.
// See docs/health-metrics.md.

import { median } from "./stats";

/** What load needs from a day's `days/` row. */
export interface LoadDay {
  trimp: number | null;
  wornMin: number;
}

export interface Load {
  /** Exponentially weighted mean daily TRIMP over about a week. */
  acute: number | null;
  /** The same over about four weeks. */
  chronic: number | null;
  ratio: number | null;
}

/**
 * Window lengths for the exponentially weighted means, λ = 2 / (N + 1) (Williams 2017). EWMA
 * rather than rolling sums: recent days weigh more, and a hard day has no cliff when it drops out.
 */
const ACUTE_DAYS = 7;
const CHRONIC_DAYS = 28;
/** Days read before the day. A day 56 back has under 2% weight in chronic, so a rebuild with
 * more history behind it gives the same numbers. */
export const LOOKBACK_DAYS = 56;
/** Our own cut-off: off the strap for more than 8 h (charging, a long shower) misses too much
 * effort for the day's TRIMP to count as it is. */
const MIN_WORN_MIN = 16 * 60;
/** With more than 2 made-up days in the last 7, acute says more about the fill than about you. */
const MAX_ACUTE_GAPS = 2;

const NO_LOAD: Load = { acute: null, chronic: null, ratio: null };

/**
 * Load for the last of `days`, oldest first, one per calendar day (null for a day with no row).
 * History starts at the first row; days before it aren't gaps. A gap (no row, no TRIMP or under
 * 16 h worn) gets the median TRIMP of the well-worn days among the 28 before the day.
 *
 * `partial` says the last day is today and its TRIMP a running total. It counts as at least that
 * median until the day ends: counting the running total alone would sag the ratio every morning
 * (to about 0.8 at a steady load), and counting it as a gap would replace a hard session already
 * done. It is never a gap.
 */
export function trainingLoad(days: (LoadDay | null)[], partial: boolean): Load {
  const start = days.findIndex((d) => d !== null);
  const fill = median(
    days
      .slice(-CHRONIC_DAYS - 1, -1)
      .filter(isWellWorn)
      .map((d) => d.trimp),
  );
  if (start < 0 || fill === null) {
    return NO_LOAD;
  }
  const series = days.slice(start);
  const last = series.length - 1;
  const values = series.map((d, i) => {
    if (i === last && partial) {
      return Math.max(d?.trimp ?? 0, fill);
    }
    return isWellWorn(d) ? d.trimp : fill;
  });
  const recent = series.slice(-ACUTE_DAYS);
  const gaps = (partial ? recent.slice(0, -1) : recent).filter((d) => !isWellWorn(d)).length;
  const acute =
    series.length >= ACUTE_DAYS && gaps <= MAX_ACUTE_GAPS ? ewma(values, ACUTE_DAYS) : null;
  const chronic = series.length >= CHRONIC_DAYS ? ewma(values, CHRONIC_DAYS) : null;
  const ratio = acute !== null && chronic !== null && chronic > 0 ? acute / chronic : null;
  return { acute, chronic, ratio };
}

export type LoadBand = "easing off" | "steady" | "building fast" | "spike";

/**
 * Gabbett 2016's bands: under 0.8, the 0.8–1.3 "sweet spot", 1.3–1.5, over 1.5. The injury-risk
 * claims made for them are disputed (Impellizzeri 2020), so they are named for load, never risk.
 */
export function loadBand(ratio: number): LoadBand {
  if (ratio < 0.8) {
    return "easing off";
  }
  if (ratio <= 1.3) {
    return "steady";
  }
  return ratio <= 1.5 ? "building fast" : "spike";
}

/** Seeded with the first day, then each day adds λ of itself (Williams 2017). */
function ewma(values: number[], days: number): number {
  const lambda = 2 / (days + 1);
  return values.slice(1).reduce((e, v) => lambda * v + (1 - lambda) * e, values[0] ?? 0);
}

function isWellWorn(d: LoadDay | null): d is LoadDay & { trimp: number } {
  return d !== null && d.trimp !== null && d.wornMin >= MIN_WORN_MIN;
}
