// Lining logged sets up with heart rate. A set lifts HR for 30–60 seconds and the rest after it
// lets HR fall, so each set is a climb. The log says how many sets there were and in what order,
// so this looks for exactly that many clear climbs and hands them out in order. See
// docs/health-metrics.md.

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
 * The `count` clearest HR climbs in `span`, oldest first, or null when there aren't that many.
 * `samples` is HR about once a second, sorted by time.
 */
export function setClimbs(samples: HeartRate[], span: Span, count: number): SetClimb[] | null {
  const series = smoothed(samples.filter((s) => s.ts >= span.start && s.ts < span.end));
  const candidates: SetClimb[] = [];
  for (let i = 1; i < series.length - 1; i++) {
    const cur = series[i];
    const prev = series[i - 1];
    const next = series[i + 1];
    if (cur && prev && next && cur.bpm >= prev.bpm && cur.bpm > next.bpm) {
      const before = series.filter((p) => p.ts >= cur.ts - LOOK_BACK_MS && p.ts <= cur.ts);
      const low = before.reduce((a, b) => (b.bpm < a.bpm ? b : a), cur);
      candidates.push({ start: low.ts, peak: cur.ts, peakHr: cur.bpm, climb: cur.bpm - low.bpm });
    }
  }
  const picked: SetClimb[] = [];
  for (const c of candidates.filter((c) => c.climb >= MIN_CLIMB_BPM).sort(byClimb)) {
    if (picked.length < count && picked.every((p) => Math.abs(p.peak - c.peak) >= MIN_GAP_MS)) {
      picked.push(c);
    }
  }
  return picked.length === count ? picked.sort((a, b) => a.peak - b.peak) : null;
}

function byClimb(a: SetClimb, b: SetClimb): number {
  return b.climb - a.climb;
}

/** Mean HR per 5 seconds, then a centred 15-second mean of those. */
function smoothed(samples: HeartRate[]): HeartRate[] {
  const steps = [...bucket(samples, STEP_MS)]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => ({ ts: key * STEP_MS, bpm: mean(group.map((s) => s.bpm)) ?? 0 }));
  return steps.map((p) => ({
    ts: p.ts,
    bpm:
      mean(steps.filter((q) => Math.abs(q.ts - p.ts) <= SMOOTH_MS / 2).map((q) => q.bpm)) ?? p.bpm,
  }));
}
