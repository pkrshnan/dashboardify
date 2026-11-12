// Walks: sustained stepping, from the step counter alone. A walk is light effort, so it rarely
// lifts heart rate enough to count as a workout, but when and how far you walked is still worth
// knowing. Cadence bands are from Tudor-Locke et al. 2018 (CADENCE-Adults). See
// docs/health-metrics.md.

import type { MinuteHr } from "./heart-rate";
import { mean, median } from "./stats";
import type { Span } from "./types";
import { MINUTE_MS } from "./types";

/** Walking with somewhere to go. Pottering around the house is slower than this. */
const WALK_SPM = 60;
/** Stops at crossings and lights don't end a walk. */
const MAX_STOP_MIN = 3;
/** The classic activity bout. */
const MIN_WALK_MIN = 10;
/** The walk to and from a recorded run is part of the outing, so it counts when shorter. */
const MIN_WALK_BY_RUN_MIN = 5;
/** 100 steps a minute is moderate intensity, about 3 METs (Tudor-Locke 2018). */
const BRISK_SPM = 100;

export interface Walk {
  start: number;
  end: number;
  minutes: number;
  /** Every step in the walk, stops included. */
  steps: number;
  /** Steps per minute, median over the minutes spent walking. */
  cadence: number;
  /** Minutes at a brisk, moderate-intensity pace. */
  briskMin: number;
  /** Null when the strap had no HR during the walk. */
  avgHr: number | null;
}

/**
 * The day's walks, oldest first. `steps` is steps per minute (see stepsPerMinute); `exclude` is
 * time already taken by sleep or a workout; `runs` are recorded runs, next to which shorter walks
 * count.
 */
export function walks(
  steps: Map<number, number>,
  minutes: MinuteHr[],
  exclude: Span[],
  runs: Span[] = [],
): Walk[] {
  const excluded = (span: Span) => exclude.some((e) => e.start < span.end && span.start < e.end);
  const walking = [...steps]
    .filter(([ts, count]) => count >= WALK_SPM && !excluded({ start: ts, end: ts + MINUTE_MS }))
    .map(([ts]) => ts)
    .sort((a, b) => a - b);
  const spans: Span[] = [];
  for (const ts of walking) {
    const last = spans[spans.length - 1];
    const stop = last && { start: last.end, end: ts };
    if (last && stop && ts - last.end <= MAX_STOP_MIN * MINUTE_MS && !excluded(stop)) {
      last.end = ts + MINUTE_MS;
    } else {
      spans.push({ start: ts, end: ts + MINUTE_MS });
    }
  }
  const gap = MAX_STOP_MIN * MINUTE_MS;
  const byRun = (s: Span) =>
    runs.some((r) => Math.abs(s.end - r.start) <= gap || Math.abs(s.start - r.end) <= gap);
  return spans
    .filter((s) => (s.end - s.start) / MINUTE_MS >= (byRun(s) ? MIN_WALK_BY_RUN_MIN : MIN_WALK_MIN))
    .map((s) => toWalk(s, steps, minutes));
}

function toWalk(span: Span, steps: Map<number, number>, minutes: MinuteHr[]): Walk {
  const inside = (ts: number) => ts >= span.start && ts < span.end;
  const counts = [...steps].filter(([ts]) => inside(ts)).map(([, count]) => count);
  const strides = counts.filter((c) => c >= WALK_SPM);
  return {
    start: span.start,
    end: span.end,
    minutes: (span.end - span.start) / MINUTE_MS,
    steps: counts.reduce((sum, c) => sum + c, 0),
    cadence: median(strides) ?? 0,
    briskMin: strides.filter((c) => c >= BRISK_SPM).length,
    avgHr: mean(minutes.filter((m) => inside(m.ts)).map((m) => m.bpm)),
  };
}
