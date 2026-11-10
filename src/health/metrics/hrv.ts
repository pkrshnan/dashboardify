// Heart rate variability from beat-to-beat gaps (RR intervals), measured during sleep.
//
// The vagus nerve slows the heart within a single beat, so when it is in charge (rest, sleep,
// recovered) consecutive gaps differ a little more. RMSSD measures exactly that: the root mean
// square of the differences between consecutive gaps. See docs/health-metrics.md.

import { median } from "./stats";
import type { RrInterval, Span } from "./types";

/** Physiologically possible gaps: 300 ms (200 bpm) to 2000 ms (30 bpm). */
const MIN_RR_MS = 300;
const MAX_RR_MS = 2000;
/** A gap more than 20% away from the median of its 11-beat neighbourhood is an artifact. */
const NEIGHBOURS = 5;
const MAX_DEVIATION = 0.2;
/** HRV is measured in 5-minute windows, the standard short-term length. */
export const WINDOW_MS = 5 * 60_000;
/** A window counts only if at least 80% of its beats survived cleaning. */
const MIN_KEPT_SHARE = 0.8;
/** And it has enough beats to mean something (about one minute's worth at rest). */
export const MIN_BEATS = 60;
/** Two kept gaps are only "consecutive" if no beat is missing between them. */
const MAX_JOIN_SLACK_MS = 150;

export interface CleanBeat extends RrInterval {
  /** False for a gap dropped by cleaning: out of range or out of line with its neighbours. */
  kept: boolean;
}

/** Mark each gap as kept or dropped. Input must be sorted by ts. */
export function cleanRr(beats: RrInterval[]): CleanBeat[] {
  const inRange = beats.map((b) => b.ms >= MIN_RR_MS && b.ms <= MAX_RR_MS);
  return beats.map((beat, i) => {
    if (!inRange[i]) {
      return { ...beat, kept: false };
    }
    const local = neighbourhood(beats, inRange, i);
    const typical = median(local) ?? beat.ms;
    return { ...beat, kept: Math.abs(beat.ms - typical) <= MAX_DEVIATION * typical };
  });
}

/** The in-range gaps within NEIGHBOURS beats either side of i, i included. */
function neighbourhood(beats: RrInterval[], inRange: boolean[], i: number): number[] {
  const from = Math.max(0, i - NEIGHBOURS);
  const to = Math.min(beats.length, i + NEIGHBOURS + 1);
  const values: number[] = [];
  for (let j = from; j < to; j++) {
    const beat = beats[j];
    if (beat && inRange[j]) {
      values.push(beat.ms);
    }
  }
  return values;
}

/**
 * Successive differences between kept gaps that really follow each other: the later beat's
 * time minus its own gap lands on the earlier beat (give or take MAX_JOIN_SLACK_MS).
 */
export function successiveDiffs(beats: CleanBeat[]): number[] {
  return timedDiffs(beats).map((d) => d.ms);
}

/** successiveDiffs, each stamped with the later beat's time, for sliding windows. */
export function timedDiffs(beats: CleanBeat[]): RrInterval[] {
  const diffs: RrInterval[] = [];
  for (let i = 1; i < beats.length; i++) {
    const prev = beats[i - 1];
    const cur = beats[i];
    if (prev?.kept && cur?.kept && Math.abs(cur.ts - cur.ms - prev.ts) <= MAX_JOIN_SLACK_MS) {
      diffs.push({ ts: cur.ts, ms: cur.ms - prev.ms });
    }
  }
  return diffs;
}

/** RMSSD in ms: √(mean of squared successive differences). */
export function rmssd(diffs: number[]): number | null {
  if (diffs.length === 0) {
    return null;
  }
  return Math.sqrt(diffs.reduce((sum, d) => sum + d * d, 0) / diffs.length);
}

/** Split beats in a span into 5-minute windows that pass the quality bar. */
export function goodWindows(beats: CleanBeat[], span: Span): CleanBeat[][] {
  const windows = new Map<number, CleanBeat[]>();
  for (const beat of beats) {
    if (beat.ts < span.start || beat.ts >= span.end) {
      continue;
    }
    const key = Math.floor((beat.ts - span.start) / WINDOW_MS);
    const window = windows.get(key);
    if (window) {
      window.push(beat);
    } else {
      windows.set(key, [beat]);
    }
  }
  return [...windows.values()].filter(isGoodWindow);
}

function isGoodWindow(window: CleanBeat[]): boolean {
  const kept = window.filter((b) => b.kept).length;
  return kept >= MIN_BEATS && kept >= MIN_KEPT_SHARE * window.length;
}

export interface NightHrv {
  /** Median of the per-window RMSSDs. */
  rmssdMs: number;
  /** ln(RMSSD): HRV is skewed, and the log makes equal ratios equal steps. */
  lnRmssd: number;
  windows: number;
}

/** The night's HRV: RMSSD per good 5-minute window during sleep, then the median window. */
export function nightHrv(beats: CleanBeat[], sleep: Span): NightHrv | null {
  const values = goodWindows(beats, sleep)
    .map((w) => rmssd(successiveDiffs(w)))
    .filter((v): v is number => v !== null && v > 0);
  const middle = median(values);
  if (middle === null) {
    return null;
  }
  return { rmssdMs: middle, lnRmssd: Math.log(middle), windows: values.length };
}
