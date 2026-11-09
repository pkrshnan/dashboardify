// Workouts: sustained efforts found in the day's heart rate, then told apart by how you stepped
// and moved. The strap gives a step counter and a motion intensity about once a second, far too
// coarse for reps or individual swings, so this names whole sessions. See docs/health-metrics.md.

import type { MinuteHr } from "./heart-rate";
import { bucket, mean, median } from "./stats";
import { reserve, type Sex, strain, trimp } from "./strain";
import type { Motion, Span } from "./types";
import { MINUTE_MS } from "./types";

/** Strain's floor for minutes that count: 30% of heart-rate reserve, plus a margin. */
const ACTIVE_RESERVE = 0.35;
/** A workout has to be hard for part of the time, not just a long walk. */
const HARD_RESERVE = 0.5;
const MIN_HARD_MIN = 5;
/** Rests between sets or games drop HR for a few minutes; longer gaps end the workout. */
const MAX_REST_MIN = 5;
const MIN_WORKOUT_MIN = 15;
/**
 * A strap that isn't moving can't be exercising. High HR from a still strap is an optical glitch,
 * like one seen at 2 am. Awake and sitting is about 0.03.
 */
const MIN_MEDIAN_MOTION = 0.02;

/**
 * Cadence bands in steps per minute. Brisk walking is 100–130 (Tudor-Locke 2018); running is
 * rarely under 140, even slow. Under 20 is standing in place.
 */
const RUN_SPM = 140;
const WALK_SPM = 90;
const STILL_SPM = 20;
/** Motion of a burst of play. Brisk walking on the bicep reads 0.25–0.33. */
const BURST_MOTION = 0.35;

export type WorkoutKind = "running" | "walking" | "volleyball" | "lifting" | "workout";

export interface Workout {
  start: number;
  end: number;
  kind: WorkoutKind;
  minutes: number;
  avgHr: number;
  maxHr: number;
  /** Steps per minute, median over the workout. */
  cadence: number;
  trimp: number;
  strain: number;
}

export interface WorkoutInput {
  minutes: MinuteHr[];
  /** Steps per minute, keyed by minute start (see stepsPerMinute). */
  steps: Map<number, number>;
  motion: Motion[];
  restingHr: number;
  maxHr: number;
  sex: Sex;
  /** Time that can't be a workout, such as last night's sleep. */
  exclude: Span[];
}

/** One minute inside a workout, with what the strap saw. */
interface Minute extends MinuteHr {
  steps: number;
  motion: number;
}

/** The day's workouts, oldest first. */
export function workouts(input: WorkoutInput): Workout[] {
  const minutes = input.minutes.filter((m) => !input.exclude.some((s) => inSpan(m.ts, s)));
  const fraction = (m: MinuteHr) => reserve(m.bpm, input.restingHr, input.maxHr);
  const motion = minuteMotion(input.motion);
  const results: Workout[] = [];
  for (const active of activeSpans(minutes.filter((m) => fraction(m) >= ACTIVE_RESERVE))) {
    const inside = trimToEffort(
      minutes
        .filter((m) => inSpan(m.ts, active))
        .map((m) => ({ ...m, steps: input.steps.get(m.ts) ?? 0, motion: motion.get(m.ts) ?? 0 })),
      fraction,
    );
    const first = inside[0];
    const last = inside[inside.length - 1];
    if (!(first && last)) {
      continue;
    }
    const span = { start: first.ts, end: last.ts + MINUTE_MS };
    const hard = inside.filter((m) => fraction(m) >= HARD_RESERVE).length;
    const moving = (median(inside.map((m) => m.motion)) ?? 0) >= MIN_MEDIAN_MOTION;
    if ((span.end - span.start) / MINUTE_MS >= MIN_WORKOUT_MIN && hard >= MIN_HARD_MIN && moving) {
      results.push(toWorkout(span, inside, input));
    }
  }
  return results;
}

/**
 * Moving in place, for finding a lifting session the note says happened. Lifting often never lifts
 * HR to a workout's level, but the arm keeps moving between sets while the feet stay put.
 */
const IN_PLACE_MOTION = 0.06;

/**
 * The longest stretch of moving in place: minutes with motion of 0.06 or more and under 20 steps,
 * joined across rests of up to 5 minutes, at least 15 minutes long. Null when there is none.
 */
export function movingInPlace(
  motion: Motion[],
  steps: Map<number, number>,
  exclude: Span[],
): Span | null {
  const busy = [...minuteMotion(motion)]
    .filter(([ts, m]) => m >= IN_PLACE_MOTION && (steps.get(ts) ?? 0) < STILL_SPM)
    .filter(([ts]) => !exclude.some((s) => inSpan(ts, s)))
    .map(([ts]) => ({ ts }))
    .sort((a, b) => a.ts - b.ts);
  return activeSpans(busy)
    .filter((s) => (s.end - s.start) / MINUTE_MS >= MIN_WORKOUT_MIN)
    .reduce<Span | null>(
      (best, s) => (best && best.end - best.start >= s.end - s.start ? best : s),
      null,
    );
}

/** Active minutes joined across rests of up to 5 minutes. */
function activeSpans(active: { ts: number }[]): Span[] {
  const spans: Span[] = [];
  for (const m of active) {
    const last = spans[spans.length - 1];
    if (last && m.ts - last.end <= MAX_REST_MIN * MINUTE_MS) {
      last.end = m.ts + MINUTE_MS;
    } else {
      spans.push({ start: m.ts, end: m.ts + MINUTE_MS });
    }
  }
  return spans;
}

/**
 * HR lags effort both ways: it takes a minute or two to climb, and many more to come back down
 * afterwards, often while you walk away. So a workout runs from its first to its last minute of
 * real effort, hard HR or a burst of movement, not for as long as HR stays up.
 */
function trimToEffort(minutes: Minute[], fraction: (m: MinuteHr) => number): Minute[] {
  const effort = (m: Minute) => fraction(m) >= HARD_RESERVE || m.motion >= BURST_MOTION;
  const first = minutes.findIndex(effort);
  let last = minutes.length - 1;
  while (last > first && !effort(minutes[last] as Minute)) {
    last--;
  }
  return first === -1 ? [] : minutes.slice(first, last + 1);
}

function toWorkout(span: Span, inside: Minute[], input: WorkoutInput): Workout {
  const total = trimp(inside, input.restingHr, input.maxHr, input.sex);
  const bpms = inside.map((m) => m.bpm);
  return {
    start: span.start,
    end: span.end,
    kind: classify(inside),
    minutes: (span.end - span.start) / MINUTE_MS,
    avgHr: mean(bpms) ?? 0,
    maxHr: Math.max(...bpms),
    cadence: median(inside.map((m) => m.steps)) ?? 0,
    trimp: total,
    strain: strain(total),
  };
}

/**
 * Running and walking are steady strides. Volleyball is stop-and-go: short shuffles, bursts of
 * hard movement and breaks between rallies. Lifting is standing in place between sets.
 */
export function classify(minutes: Minute[]): WorkoutKind {
  const share = (test: (m: Minute) => boolean) =>
    minutes.filter(test).length / Math.max(1, minutes.length);
  if (share((m) => m.steps >= RUN_SPM) >= 0.5) {
    return "running";
  }
  if (share((m) => m.steps >= WALK_SPM) >= 0.5) {
    return "walking";
  }
  const bursts = share((m) => m.motion >= BURST_MOTION);
  if (share((m) => m.steps >= STILL_SPM && m.steps < WALK_SPM) >= 0.3 && bursts >= 0.2) {
    return "volleyball";
  }
  if (share((m) => m.steps < STILL_SPM) >= 0.6 && bursts < 0.2) {
    return "lifting";
  }
  return "workout";
}

/** Mean motion intensity per minute, keyed by minute start. */
function minuteMotion(samples: Motion[]): Map<number, number> {
  return new Map(
    [...bucket(samples, MINUTE_MS)].map(([key, group]) => [
      key * MINUTE_MS,
      mean(group.map((s) => s.intensity)) ?? 0,
    ]),
  );
}

function inSpan(ts: number, span: Span): boolean {
  return ts >= span.start && ts < span.end;
}
