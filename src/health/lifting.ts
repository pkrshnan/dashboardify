// A day's lifting: the log from the daily note, joined to the strap's lifting session when there
// is one. Sets are matched to HR climbs in the order they were logged.

import { type Exercise, type LoggedSet, loggedSets } from "../vault/lifting";
import { type SetClimb, setClimbs } from "./metrics/sets";
import type { HeartRate } from "./metrics/types";
import type { Workout } from "./metrics/workouts";

const LB_PER_KG = 2.20462;

export interface LiftingSet extends LoggedSet {
  /** The HR climb this set was matched to; null when the sets couldn't be matched. */
  climb: SetClimb | null;
}

export interface LiftingDay {
  exercises: number;
  sets: LiftingSet[];
  /** Weight × reps over every set, in pounds. Bodyweight sets add nothing. */
  volumeLb: number;
  /** The strap session the log was joined to, if any. */
  session: Workout | null;
  /** Whether every set found its HR climb. */
  matched: boolean;
}

/**
 * Join the log to the day's lifting session: the longest workout named lifting, or else the
 * longest unnamed one. Null when the note has no log.
 */
export function liftingDay(
  exercises: Exercise[],
  workouts: Workout[],
  heartRate: HeartRate[],
): LiftingDay | null {
  const logged = loggedSets(exercises);
  if (logged.length === 0) {
    return null;
  }
  const session = longest(workouts, "lifting") ?? longest(workouts, "workout");
  const climbs = session ? setClimbs(heartRate, session, logged.length) : null;
  return {
    exercises: exercises.length,
    sets: logged.map((set, i) => ({ ...set, climb: climbs?.[i] ?? null })),
    volumeLb: logged.reduce((sum, s) => sum + pounds(s) * s.reps, 0),
    session,
    matched: climbs !== null,
  };
}

function longest(workouts: Workout[], kind: Workout["kind"]): Workout | null {
  return workouts
    .filter((w) => w.kind === kind)
    .reduce<Workout | null>((best, w) => (best && best.minutes >= w.minutes ? best : w), null);
}

function pounds(set: LoggedSet): number {
  return set.unit === "kg" ? (set.weight ?? 0) * LB_PER_KG : (set.weight ?? 0);
}
