// The log screen's rules (docs/lifting.md), kept out of the components so they can be tested
// without a DOM: what a new exercise starts with, numbering and tagging sets, the steppers, and
// which exercises to offer when adding one.

import { exerciseSlug } from "../../src/lifting/names";
import type { ExerciseView, WorkoutLogView, WorkSetView } from "../api";

/** One exercise as the log screen edits it. */
export interface Draft {
  slug: string;
  title: string;
  unit: "lb" | "kg";
  sets: WorkSetView[];
}

/** An exercise's next time, or one empty set for one never done. */
export function startingSets(exercise: ExerciseView | undefined): WorkSetView[] {
  return exercise?.next?.sets.map((s) => ({ ...s })) ?? [{ weight: null, reps: 0, warmUp: false }];
}

/** A draft to add, from the history when there is one. */
export function newDraft(title: string, exercise: ExerciseView | undefined): Draft {
  return {
    slug: exercise?.slug ?? exerciseSlug(title),
    title: exercise?.title ?? title.trim(),
    unit: exercise?.unit ?? "lb",
    sets: startingSets(exercise),
  };
}

/** "W" for a warm-up; working sets count 1, 2, 3 on their own. */
export function setLabels(sets: WorkSetView[]): string[] {
  let n = 0;
  return sets.map((s) => {
    if (s.warmUp) {
      return "W";
    }
    n += 1;
    return String(n);
  });
}

export function toggleWarmUp(sets: WorkSetView[], i: number): WorkSetView[] {
  return sets.map((s, j) => (j === i ? { ...s, warmUp: !s.warmUp } : s));
}

/** The weight's ± step: the smallest plate most gyms have. */
export function weightStep(unit: "lb" | "kg"): number {
  return unit === "kg" ? 1 : 2.5;
}

export function stepWeight(sets: WorkSetView[], i: number, by: number): WorkSetView[] {
  return sets.map((s, j) => {
    if (j !== i) {
      return s;
    }
    const weight = Math.max(0, Math.round(((s.weight ?? 0) + by) * 100) / 100);
    return { ...s, weight: weight === 0 ? null : weight };
  });
}

export function setWeight(sets: WorkSetView[], i: number, weight: number | null): WorkSetView[] {
  return sets.map((s, j) => (j === i ? { ...s, weight: weight && weight > 0 ? weight : null } : s));
}

export function stepReps(sets: WorkSetView[], i: number, by: number): WorkSetView[] {
  return sets.map((s, j) => (j === i ? { ...s, reps: Math.max(0, s.reps + by) } : s));
}

export function removeSet(sets: WorkSetView[], i: number): WorkSetView[] {
  return sets.filter((_, j) => j !== i);
}

/** Another set like the last working one. */
export function addSet(sets: WorkSetView[]): WorkSetView[] {
  const last = sets.filter((s) => !s.warmUp).pop() ?? sets[sets.length - 1];
  return [...sets, { weight: last?.weight ?? null, reps: last?.reps ?? 0, warmUp: false }];
}

/** Only sets with reps go into the note; an empty row is still being filled in. */
export function toSave(sets: WorkSetView[]): WorkSetView[] {
  return sets.filter((s) => s.reps > 0);
}

/** The day's log as drafts, keeping each exercise's unit. */
export function draftsOf(log: WorkoutLogView): Draft[] {
  return log.exercises.map((e) => ({ ...e, sets: e.sets.map((s) => ({ ...s })) }));
}

/**
 * What you did alongside `current` the last time you did it, not logged today yet: the rest of
 * that day's session, in a sensible order to offer next.
 */
export function usuallyNext(
  current: string | undefined,
  exercises: ExerciseView[],
  logged: string[],
): ExerciseView[] {
  const day = exercises.find((e) => e.slug === current)?.sessions[0]?.date;
  if (!day) {
    return [];
  }
  return exercises.filter(
    (e) => e.sessions[0]?.date === day && e.slug !== current && !logged.includes(e.slug),
  );
}

/** Exercises matching what's typed, and the typed name as a new one when nothing matches it. */
export function addChoices(
  exercises: ExerciseView[],
  query: string,
  logged: string[],
): { matches: ExerciseView[]; newTitle: string | null } {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return { matches: [], newTitle: null };
  }
  const open = exercises.filter((e) => !logged.includes(e.slug));
  const matches = open.filter((e) =>
    [e.title, ...e.aliases].some((n) => n.toLowerCase().includes(q)),
  );
  const exact = exercises.some((e) => exerciseSlug(e.title) === exerciseSlug(query));
  return { matches, newTitle: exact ? null : query.trim() };
}
