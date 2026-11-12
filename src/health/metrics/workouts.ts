// Workouts: stretches where HR is well above your own awake baseline, or up while you move, that
// were either hard or had lifting's spike-and-calm rhythm. Then told apart by how you stepped and
// moved. The strap gives a step counter and a motion intensity about once a second, far too coarse
// for reps or individual swings, so this names whole sessions. See docs/health-metrics.md.

import type { MinuteHr } from "./heart-rate";
import type { SetClimb } from "./sets";
import { bucket, mean, median, percentile } from "./stats";
import { reserve, type Sex, strain, trimp } from "./strain";
import type { Motion, Span } from "./types";
import { MINUTE_MS } from "./types";

/**
 * Your awake baseline is the 25th percentile of the day's awake minutes: mostly sitting, even on an
 * active day. A minute is active 20 bpm above it, or 8 above it while moving.
 */
const BASELINE_PERCENTILE = 25;
const ELEVATED_BPM = 20;
const MOVING_ELEVATED_BPM = 8;
const MOVING_MOTION = 0.08;
/** A cardio workout is hard for part of the time, at half of heart-rate reserve or more. */
const HARD_RESERVE = 0.5;
const MIN_HARD_MIN = 5;
/**
 * Lifting rarely gets that hard. It shows instead as big HR climbs, one a set, that keep coming:
 * at least 2 every 10 minutes. Sitting still has climbs of 10 bpm several times every 10 minutes
 * from ordinary HR swings, but rarely of 25.
 */
export const BIG_CLIMB_BPM = 25;
const MIN_CLIMBS_PER_10_MIN = 2;
/** And enough of them to be a session, not a few stairs: about half an hour of sets. */
const MIN_CLIMBS = 6;
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
  /** Runs recorded in Strava only (see runs.ts). */
  distanceMeters?: number;
  stravaId?: number;
}

export interface WorkoutInput {
  minutes: MinuteHr[];
  /** The day's HR climbs of 25+ bpm (see climbs in sets.ts). */
  climbs: SetClimb[];
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
  const baseline = percentile(
    minutes.map((m) => m.bpm),
    BASELINE_PERCENTILE,
  );
  if (baseline === null) {
    return [];
  }
  const motion = minuteMotion(input.motion);
  const withData = minutes.map((m) => ({
    ...m,
    steps: input.steps.get(m.ts) ?? 0,
    motion: motion.get(m.ts) ?? 0,
  }));
  // A minute where a big climb peaks is active too, so a set always belongs to its session.
  const peaks = new Set(input.climbs.map((c) => Math.floor(c.peak / MINUTE_MS) * MINUTE_MS));
  const active = withData.filter(
    (m) =>
      m.bpm >= baseline + ELEVATED_BPM ||
      (m.bpm >= baseline + MOVING_ELEVATED_BPM && m.motion >= MOVING_MOTION) ||
      peaks.has(m.ts),
  );
  const results: Workout[] = [];
  for (const candidate of activeSpans(active)) {
    const workout = toWorkout(
      withData.filter((m) => inSpan(m.ts, candidate)),
      input,
    );
    if (workout) {
      results.push(workout);
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
 * real effort: hard HR, a burst of movement or a big climb, not for as long as HR stays up.
 */
function trimToEffort(minutes: Minute[], effort: (m: Minute) => boolean): Minute[] {
  const first = minutes.findIndex(effort);
  let last = minutes.length - 1;
  while (last > first && !effort(minutes[last] as Minute)) {
    last--;
  }
  return first === -1 ? [] : minutes.slice(first, last + 1);
}

/**
 * A workout from a candidate stretch, or null when it was neither hard nor lifting. A hard workout
 * is trimmed to its hard minutes and bursts of movement; a climb in the warm-up or the recovery
 * doesn't stretch it. Only failing that is it checked for lifting, trimmed to its climbs too.
 */
function toWorkout(candidate: Minute[], input: WorkoutInput): Workout | null {
  const hard = (m: Minute) => reserve(m.bpm, input.restingHr, input.maxHr) >= HARD_RESERVE;
  const burst = (m: Minute) => m.motion >= BURST_MOTION;
  const climbsIn = (span: Span) =>
    input.climbs.filter((c) => c.peak >= span.start && c.peak < span.end).length;
  const climbing = (m: Minute) => climbsIn({ start: m.ts, end: m.ts + MINUTE_MS }) > 0;
  const rhythm = (s: Session) =>
    climbsIn(s.span) >= Math.max(MIN_CLIMBS, (s.length / 10) * MIN_CLIMBS_PER_10_MIN);

  const cardio = session(trimToEffort(candidate, (m) => hard(m) || burst(m)));
  if (cardio && cardio.inside.filter(hard).length >= MIN_HARD_MIN) {
    const workout = describe(cardio, rhythm(cardio), input);
    if (workout.kind !== "lifting") {
      return workout;
    }
    // Hard lifting still has sets that weren't hard, like a warm-up. Their climbs show them.
    const sets = session(widen(candidate, cardio, climbing));
    const widened = sets && describe(sets, true, input);
    return widened?.kind === "lifting" ? widened : workout;
  }
  const lifting = session(trimToEffort(candidate, (m) => hard(m) || burst(m) || climbing(m)));
  return lifting && rhythm(lifting) ? describe(lifting, true, input) : null;
}

/**
 * The session widened over climbs each within a rest of its edge, as sets go. A climb further out
 * is standing up or walking off afterwards, not a set.
 */
function widen(candidate: Minute[], s: Session, climbing: (m: Minute) => boolean): Minute[] {
  const rest = MAX_REST_MIN * MINUTE_MS;
  let first = candidate.indexOf(s.inside[0] as Minute);
  let last = candidate.indexOf(s.inside[s.inside.length - 1] as Minute);
  for (let i = first - 1; i >= 0; i--) {
    const m = candidate[i] as Minute;
    if ((candidate[first] as Minute).ts - m.ts > rest) {
      break;
    }
    first = climbing(m) ? i : first;
  }
  for (let i = last + 1; i < candidate.length; i++) {
    const m = candidate[i] as Minute;
    if (m.ts - (candidate[last] as Minute).ts > rest) {
      break;
    }
    last = climbing(m) ? i : last;
  }
  return candidate.slice(first, last + 1);
}

interface Session {
  inside: Minute[];
  span: Span;
  length: number;
}

/** The trimmed minutes as a session, or null when too short or the strap wasn't moving. */
function session(inside: Minute[]): Session | null {
  const first = inside[0];
  const last = inside[inside.length - 1];
  if (!(first && last)) {
    return null;
  }
  const span = { start: first.ts, end: last.ts + MINUTE_MS };
  const length = (span.end - span.start) / MINUTE_MS;
  const moving = (median(inside.map((m) => m.motion)) ?? 0) >= MIN_MEDIAN_MOTION;
  return length >= MIN_WORKOUT_MIN && moving ? { inside, span, length } : null;
}

function describe(s: Session, rhythm: boolean, input: WorkoutInput): Workout {
  const total = trimp(s.inside, input.restingHr, input.maxHr, input.sex);
  const bpms = s.inside.map((m) => m.bpm);
  return {
    start: s.span.start,
    end: s.span.end,
    kind: classify(s.inside, rhythm),
    minutes: s.length,
    avgHr: mean(bpms) ?? 0,
    maxHr: Math.max(...bpms),
    cadence: median(s.inside.map((m) => m.steps)) ?? 0,
    trimp: total,
    strain: strain(total),
  };
}

/**
 * Running and walking are steady strides. Volleyball is stop-and-go: short shuffles, bursts of
 * hard movement and breaks between rallies. Lifting is standing in place, with HR spiking each set
 * and calming between (`rhythm`).
 */
export function classify(minutes: Minute[], rhythm: boolean): WorkoutKind {
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
  if (share((m) => m.steps < STILL_SPM) >= 0.6 && bursts < 0.2 && rhythm) {
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
