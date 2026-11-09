// How sure each workout's name is, with your reviews and the lifting log applied. A review
// matches the workout it overlaps by at least half, so a small change in how a workout is
// trimmed doesn't lose it.

import type { ReviewKind } from "../vault/workout-reviews";
import type { Span } from "./metrics/types";
import type { Workout, WorkoutKind } from "./metrics/workouts";

export type WorkoutStatus = "detected" | "possible" | "confirmed" | "dismissed";

export interface ReviewedWorkout extends Workout {
  status: WorkoutStatus;
}

export interface Review {
  span: Span;
  kind: ReviewKind;
}

const MIN_OVERLAP = 0.5;

/** The review for a workout, if any. */
export function reviewFor(workout: Span, reviews: Review[]): Review | null {
  const length = workout.end - workout.start;
  return (
    reviews.find((r) => {
      const overlap = Math.min(r.span.end, workout.end) - Math.max(r.span.start, workout.start);
      return length > 0 && overlap / length >= MIN_OVERLAP;
    }) ?? null
  );
}

/**
 * Each workout with its status. A review decides it. Otherwise a workout the note's lifting log
 * was matched to is confirmed lifting; lifting with no log that day, or a workout of unknown kind,
 * is possible and worth asking about; anything else is detected.
 */
export function reviewWorkouts(
  workouts: Workout[],
  reviews: Review[],
  lifting: { session: Span | null; logged: boolean },
): ReviewedWorkout[] {
  return workouts.map((w) => reviewed(w, reviewFor(w, reviews), lifting));
}

function reviewed(
  w: Workout,
  review: Review | null,
  lifting: { session: Span | null; logged: boolean },
): ReviewedWorkout {
  if (review) {
    return review.kind === "none"
      ? { ...w, status: "dismissed" }
      : { ...w, kind: review.kind as WorkoutKind, status: "confirmed" };
  }
  if (lifting.session && reviewFor(w, [{ span: lifting.session, kind: "lifting" }])) {
    return { ...w, kind: "lifting", status: "confirmed" };
  }
  const unsure = w.kind === "workout" || (w.kind === "lifting" && !lifting.logged);
  return { ...w, status: unsure ? "possible" : "detected" };
}

/** The workouts that count: everything you didn't dismiss. */
export function counted(workouts: ReviewedWorkout[]): ReviewedWorkout[] {
  return workouts.filter((w) => w.status !== "dismissed");
}
