// When each matched set began and ended, from the strap's motion. HR is a slow guide: its low
// point can come half a minute before you start, and it often peaks after you've stopped. The
// strap's motion jumps the moment a set starts and falls when you rack the weight, so a set's edges
// are taken from the run of moving in place around its climb. Steps rule out walking to the next
// station. Where motion is unclear, the climb's own edges stand. See docs/health-metrics.md.

import type { SetClimb } from "./sets";
import { mean, percentile } from "./stats";
import { stepDelta } from "./steps";
import type { Motion, StepCounter } from "./types";

const SECOND_MS = 1000;
/** Motion is averaged over 11 seconds, so one still second mid-set doesn't end it. */
const SMOOTH_S = 5;
/** Moving is this many times resting motion, and at least the floor; rest is the 20th percentile. */
const REST_PERCENTILE = 20;
const MOVING_TIMES_REST = 3;
const MOVING_FLOOR = 0.04;
/**
 * Twelve or more steps in the 10 seconds around a second is walking, not a set. The counter jumps
 * a few steps at a time, and pressing or pulling can add a step every two seconds, so fewer is
 * the set itself.
 */
const WALK_WINDOW_S = 5;
const WALK_STEPS = 12;
/** Moving runs this close together are one: a pause to grip or reset mid-set. */
const JOIN_GAP_S = 8;
/** A run is looked for from just before the climb's low point to just after its peak. */
const BEFORE_CLIMB_MS = 30_000;
const AFTER_PEAK_MS = 5_000;
/** It must cover this much of that window to be the set. */
const MIN_OVERLAP_S = 15;
/** A set doesn't end more than this after its climb peaks. */
const MAX_AFTER_PEAK_MS = 20_000;
/**
 * A run longer than this is more than the set: setting up, or fiddling with the weight. Its end
 * still marks the set's, but its start doesn't, so the climb's low point stands.
 */
const MAX_RUN_MS = 90_000;
/** Shorter than this is a fidget, not a set. */
const MIN_SET_MS = 15_000;
/** How far either side of the climbs resting motion is measured. */
const MARGIN_MS = 5 * 60_000;

export interface SetSpan {
  start: number;
  end: number;
  /** Whether motion gave the edges; otherwise they're the climb's low point and peak. */
  byMotion: boolean;
}

/** Each climb's set, in the climbs' order (sorted by peak). */
export function setSpans(climbs: SetClimb[], motion: Motion[], steps: StepCounter[]): SetSpan[] {
  const first = climbs[0];
  const last = climbs[climbs.length - 1];
  if (!(first && last)) {
    return [];
  }
  const grid = new Grid(first.start - MARGIN_MS, last.peak + MARGIN_MS, motion, steps);
  const runs = grid.runs();
  const picks = climbs.map((c) =>
    bestRun(runs, grid.second(c.start - BEFORE_CLIMB_MS), grid.second(c.peak + AFTER_PEAK_MS)),
  );
  let previousEnd = Number.NEGATIVE_INFINITY;
  return climbs.map((c, i) => {
    const run = picks[i];
    // Two sets in one run means motion can't split them: leave both to HR.
    const shared = run && (picks[i - 1] === run || picks[i + 1] === run);
    const span =
      run && !shared
        ? {
            start: Math.max(startOf(run, grid, c), previousEnd),
            end: Math.min(grid.time(run.end), c.peak + MAX_AFTER_PEAK_MS),
            byMotion: true,
          }
        : null;
    const kept =
      span && span.end - span.start >= MIN_SET_MS
        ? span
        : { start: Math.max(c.start, previousEnd), end: c.peak, byMotion: false };
    previousEnd = kept.end;
    return kept;
  });
}

/** Where motion picked up, unless the run is too long to say. */
function startOf(run: Run, grid: Grid, climb: SetClimb): number {
  const start = grid.time(run.start);
  return grid.time(run.end) - start > MAX_RUN_MS ? Math.max(start, climb.start) : start;
}

interface Run {
  /** Seconds into the grid, [start, end). */
  start: number;
  end: number;
}

/** The run covering most of [from, to), if it covers enough. */
function bestRun(runs: Run[], from: number, to: number): Run | null {
  let best: Run | null = null;
  let most = MIN_OVERLAP_S - 1;
  for (const run of runs) {
    const overlap = Math.min(run.end, to) - Math.max(run.start, from);
    if (overlap > most) {
      most = overlap;
      best = run;
    }
  }
  return best;
}

/** Each stretch of moving seconds, joined across short pauses. */
function joined(moving: boolean[]): Run[] {
  const runs: Run[] = [];
  for (const run of stretches(moving)) {
    const last = runs[runs.length - 1];
    if (last && run.start - last.end <= JOIN_GAP_S) {
      last.end = run.end;
    } else {
      runs.push({ ...run });
    }
  }
  return runs;
}

/** Each unbroken stretch of true seconds. */
function stretches(moving: boolean[]): Run[] {
  const found: Run[] = [];
  let start = -1;
  for (let i = 0; i <= moving.length; i++) {
    if (moving[i] && start < 0) {
      start = i;
    } else if (!moving[i] && start >= 0) {
      found.push({ start, end: i });
      start = -1;
    }
  }
  return found;
}

/** Motion and steps per second across the session. */
class Grid {
  private readonly motion: (number | null)[];
  /** The step counter's latest reading at each second. */
  private readonly steps: (StepCounter | null)[];

  constructor(
    private readonly from: number,
    to: number,
    motion: Motion[],
    steps: StepCounter[],
  ) {
    const size = Math.max(0, Math.ceil((to - from) / SECOND_MS));
    this.motion = new Array(size).fill(null);
    this.steps = new Array(size).fill(null);
    for (const m of motion) {
      const i = this.second(m.ts);
      if (i >= 0 && i < size) {
        this.motion[i] = m.intensity;
      }
    }
    let k = 0;
    let latest: StepCounter | null = null;
    for (let i = 0; i < size; i++) {
      for (; k < steps.length && (steps[k]?.ts ?? 0) < this.time(i + 1); k++) {
        latest = steps[k] ?? latest;
      }
      this.steps[i] = latest;
    }
  }

  second(ts: number): number {
    return Math.floor((ts - this.from) / SECOND_MS);
  }

  time(second: number): number {
    return this.from + second * SECOND_MS;
  }

  /** Stretches of moving in place, joined across short pauses. */
  runs(): Run[] {
    const known = this.motion.filter((v): v is number => v !== null);
    const rest = percentile(known, REST_PERCENTILE) ?? 0;
    const threshold = Math.max(MOVING_FLOOR, MOVING_TIMES_REST * rest);
    return joined(this.motion.map((_, i) => this.smoothed(i) >= threshold && !this.walking(i)));
  }

  private smoothed(i: number): number {
    const near = this.motion
      .slice(Math.max(0, i - SMOOTH_S), i + SMOOTH_S + 1)
      .filter((v): v is number => v !== null);
    return mean(near) ?? 0;
  }

  private walking(i: number): boolean {
    const before = this.steps[Math.max(0, i - WALK_WINDOW_S)];
    const after = this.steps[Math.min(this.steps.length - 1, i + WALK_WINDOW_S)];
    return before && after && after.ts > before.ts ? stepDelta(before, after) >= WALK_STEPS : false;
  }
}
