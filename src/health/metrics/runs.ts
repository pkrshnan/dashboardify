// Runs you recorded in Strava. You record only the running part, so a run's window marks where
// the running was inside a longer strap session: the run becomes its own workout, and the rest of
// that session goes back to the walk finder (see docs/strava.md).

import type { MinuteHr } from "./heart-rate";
import { mean, median } from "./stats";
import { type Sex, strain, trimp } from "./strain";
import type { Span } from "./types";
import { MINUTE_MS } from "./types";
import type { Workout } from "./workouts";

export interface RecordedRun {
  /** Start and end (start plus elapsed time), UTC milliseconds. */
  start: number;
  end: number;
  distanceMeters: number;
  stravaId: number;
}

export interface RunContext {
  minutes: MinuteHr[];
  /** Steps per minute, keyed by minute start. */
  steps: Map<number, number>;
  restingHr: number;
  maxHr: number;
  sex: Sex;
}

/**
 * The strap's workouts with the runs put in: a workout a run overlaps is replaced by the run, so
 * its warm-up and cool-down walks are free to be found as walks. Oldest first.
 */
export function withRuns(found: Workout[], runs: RecordedRun[], ctx: RunContext): Workout[] {
  const made = runs.map((run) => runWorkout(run, ctx)).filter((w) => w.minutes > 0);
  const kept = found.filter((w) => !made.some((r) => overlaps(w, r)));
  return [...kept, ...made].sort((a, b) => a.start - b.start);
}

/** A run's window on the strap's minutes. The phone's and strap's clocks can be a minute apart. */
export function runSpan(run: RecordedRun): Span {
  return { start: nearestMinute(run.start), end: nearestMinute(run.end) };
}

function runWorkout(run: RecordedRun, ctx: RunContext): Workout {
  const span = runSpan(run);
  const inside = ctx.minutes.filter((m) => m.ts >= span.start && m.ts < span.end);
  const bpms = inside.map((m) => m.bpm);
  const steps: number[] = [];
  for (let ts = span.start; ts < span.end; ts += MINUTE_MS) {
    steps.push(ctx.steps.get(ts) ?? 0);
  }
  const total = trimp(inside, ctx.restingHr, ctx.maxHr, ctx.sex);
  return {
    start: span.start,
    end: span.end,
    kind: "running",
    minutes: (span.end - span.start) / MINUTE_MS,
    // 0 when the strap wasn't worn, as the API's "no data" is.
    avgHr: mean(bpms) ?? 0,
    maxHr: bpms.length > 0 ? Math.max(...bpms) : 0,
    cadence: median(steps) ?? 0,
    trimp: total,
    strain: strain(total),
    distanceMeters: run.distanceMeters,
    stravaId: run.stravaId,
    // dayMetrics fills it in from the run's own window, as for any workout.
    kcal: null,
  };
}

function nearestMinute(ts: number): number {
  return Math.round(ts / MINUTE_MS) * MINUTE_MS;
}

function overlaps(a: Span, b: Span): boolean {
  return a.start < b.end && b.start < a.end;
}
