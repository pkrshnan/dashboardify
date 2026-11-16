// A day's lifting: the log from the daily note, joined to the strap's lifting session when there
// is one. Sets are matched to HR climbs in the order they were logged.

import { type Exercise, type LoggedSet, loggedSets } from "../vault/lifting";
import { alignSets, sessionRun } from "./metrics/set-align";
import { type SetSpan, setSpans } from "./metrics/set-edges";
import { climbs as findClimbs, type SetClimb } from "./metrics/sets";
import type { HeartRate, Motion, Span, StepCounter } from "./metrics/types";
import type { Workout } from "./metrics/workouts";

const LB_PER_KG = 2.20462;

export interface LiftingSet extends LoggedSet {
  /** The HR climb this set was matched to; null when the sets couldn't be matched. */
  climb: SetClimb | null;
  /** When the set began and ended, from motion where it's clear; null with the climb. */
  span: SetSpan | null;
}

export interface LiftingDay {
  exercises: number;
  sets: LiftingSet[];
  /** Weight × reps over every set, in pounds. Bodyweight sets add nothing. */
  volumeLb: number;
  /** The stretch of strap data the log was joined to, if any. */
  session: Span | null;
  /** A workout the strap found, or moving in place when HR never got that high. */
  found: "workout" | "movement" | null;
  /** Whether every set found its HR climb. */
  matched: boolean;
}

/**
 * Join the log to the day's lifting session: the longest workout named lifting, else the longest
 * unnamed one, else `moving` (see movingInPlace). Null when the note has no log.
 */
export function liftingDay(
  exercises: Exercise[],
  workouts: Workout[],
  moving: Span | null,
  strap: { heartRate: HeartRate[]; motion: Motion[]; steps: StepCounter[] },
): LiftingDay | null {
  const logged = loggedSets(exercises);
  if (logged.length === 0) {
    return null;
  }
  const workout = longest(workouts, "lifting") ?? longest(workouts, "workout");
  const session = workout ?? moving;
  const climbs = session ? matchSets(strap.heartRate, session, logged) : null;
  const spans = climbs ? setSpans(climbs, strap.motion, strap.steps) : null;
  return {
    exercises: exercises.length,
    sets: logged.map((set, i) => ({
      ...set,
      climb: climbs?.[i] ?? null,
      span: spans?.[i] ?? null,
    })),
    volumeLb: logged.reduce((sum, s) => sum + pounds(s) * s.reps, 0),
    session: session ? { start: session.start, end: session.end } : null,
    found: foundBy(workout, moving),
    matched: climbs !== null,
  };
}

/** How far either side of the session a run of climbs is followed for sets it trimmed off. */
const REACH_MS = 25 * 60_000;

/** The session's climbs, and any run carrying on past its edges, lined up with the log. */
function matchSets(heartRate: HeartRate[], session: Span, logged: LoggedSet[]): SetClimb[] | null {
  const near = findClimbs(heartRate, {
    start: session.start - REACH_MS,
    end: session.end + REACH_MS,
  });
  return alignSets(sessionRun(session, near), logged);
}

function foundBy(workout: Workout | null, moving: Span | null): LiftingDay["found"] {
  if (workout) {
    return "workout";
  }
  return moving ? "movement" : null;
}

function longest(workouts: Workout[], kind: Workout["kind"]): Workout | null {
  return workouts
    .filter((w) => w.kind === kind)
    .reduce<Workout | null>((best, w) => (best && best.minutes >= w.minutes ? best : w), null);
}

function pounds(set: LoggedSet): number {
  return set.unit === "kg" ? (set.weight ?? 0) * LB_PER_KG : (set.weight ?? 0);
}
