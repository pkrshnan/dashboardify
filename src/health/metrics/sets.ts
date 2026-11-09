// HR climbs: the spike-and-calm of lifting. A set lifts HR for 30–60 seconds and the rest after it
// lets HR fall, so each set is a climb. Lifting is found by how many big climbs keep coming, and a
// logged session's sets are matched to its clearest climbs in order. See docs/health-metrics.md.

import { bucket, mean } from "./stats";
import type { HeartRate, Span } from "./types";

/** HR is averaged per 5 seconds and smoothed over 15, so one noisy beat isn't a set. */
const SMOOTH_MS = 15_000;
const STEP_MS = 5_000;
/** A climb is measured from the lowest point in the 90 seconds before its peak. */
const LOOK_BACK_MS = 90_000;
/** Less of a rise than this is noise, not a set. */
const MIN_CLIMB_BPM = 6;
/** Two sets can't peak closer together than this. */
const MIN_GAP_MS = 60_000;

export interface SetClimb {
  /** The low point before the climb: about when the set started. */
  start: number;
  /** The top of the climb: about when the set ended. */
  peak: number;
  peakHr: number;
  /** How far HR rose, in bpm. */
  climb: number;
}

/**
 * Every distinct HR climb of at least `minClimb` bpm in `span`, oldest first. Where two peak within
 * a minute of each other, the bigger one is kept. `samples` is HR about once a second, sorted.
 */
export function climbs(samples: HeartRate[], span: Span, minClimb = MIN_CLIMB_BPM): SetClimb[] {
  return distinct(peaks(smoothed(samples.filter((s) => s.ts >= span.start && s.ts < span.end))))
    .filter((c) => c.climb >= minClimb)
    .sort((a, b) => a.peak - b.peak);
}

/** The `count` clearest climbs in `span`, oldest first, or null when there aren't that many. */
export function setClimbs(samples: HeartRate[], span: Span, count: number): SetClimb[] | null {
  const clearest = climbs(samples, span).sort(byClimb).slice(0, count);
  return clearest.length === count ? clearest.sort((a, b) => a.peak - b.peak) : null;
}

/** Each local peak, with its rise from the lowest point in the 90 seconds before it. */
function peaks(series: HeartRate[]): SetClimb[] {
  const found: SetClimb[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    const cur = series[i] as HeartRate;
    if (cur.bpm >= (series[i - 1]?.bpm ?? 0) && cur.bpm > (series[i + 1]?.bpm ?? 0)) {
      const low = lowBefore(series, i);
      found.push({ start: low.ts, peak: cur.ts, peakHr: cur.bpm, climb: cur.bpm - low.bpm });
    }
  }
  return found;
}

/** The lowest point in the 90 seconds up to `series[i]`. */
function lowBefore(series: HeartRate[], i: number): HeartRate {
  const peak = series[i] as HeartRate;
  let low = peak;
  for (let j = i - 1; j >= 0; j--) {
    const p = series[j] as HeartRate;
    if (p.ts < peak.ts - LOOK_BACK_MS) {
      break;
    }
    low = p.bpm < low.bpm ? p : low;
  }
  return low;
}

/** Biggest first, skipping any that peaks within a minute of one already kept. */
function distinct(candidates: SetClimb[]): SetClimb[] {
  const kept: SetClimb[] = [];
  for (const c of [...candidates].sort(byClimb)) {
    if (kept.every((k) => Math.abs(k.peak - c.peak) >= MIN_GAP_MS)) {
      kept.push(c);
    }
  }
  return kept;
}

function byClimb(a: SetClimb, b: SetClimb): number {
  return b.climb - a.climb;
}

/** Mean HR per 5 seconds, then a centred 15-second mean: each step with its neighbours. */
function smoothed(samples: HeartRate[]): HeartRate[] {
  const steps = [...bucket(samples, STEP_MS)]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => ({ ts: key * STEP_MS, bpm: mean(group.map((s) => s.bpm)) ?? 0 }));
  return steps.map((p, i) => {
    const near = [steps[i - 1], p, steps[i + 1]].filter(
      (q): q is HeartRate => q !== undefined && Math.abs(q.ts - p.ts) <= SMOOTH_MS / 2,
    );
    return { ts: p.ts, bpm: mean(near.map((q) => q.bpm)) ?? p.bpm };
  });
}
