// Each exercise's sessions across the daily notes, and the numbers that show overload: the top
// working weight, the reps at it, an estimated 1RM, and how each session compares with the one
// before. docs/lifting.md has the rules.

import type { Exercise, LoadLine, WeightUnit } from "../vault/lifting";
import { exerciseKey } from "./names";

const LB_PER_KG = 2.20462;
/** A weight typed in the other unit is rounded, so 132.3 lb is 60 kg. Plates step by 0.5 or more. */
const SAME_WEIGHT = 0.1;

export interface DayLog {
  date: string;
  exercises: Exercise[];
}

export interface WorkSet {
  /** In the history's unit; null for bodyweight. */
  weight: number | null;
  reps: number;
  warmUp: boolean;
}

export type Progress = "weight" | "reps" | "same" | "down";

export interface Session {
  date: string;
  /** In the order done. */
  sets: WorkSet[];
  /** The heaviest working weight; null for bodyweight. */
  topWeight: number | null;
  /** The reps of each working set at the top weight; every working set for bodyweight. */
  repsAtTop: number[];
  /** Epley on the average set at the top weight; null for bodyweight. */
  est1rm: number | null;
  /** Weight × reps over the working sets. */
  volume: number;
  /** Against the session before; null for the first, or when only one of them was bodyweight. */
  progress: Progress | null;
}

export interface Best<T> {
  value: T;
  /** The first session that reached it. */
  date: string;
}

export interface Records {
  heaviest: Best<number> | null;
  est1rm: Best<number> | null;
  /** The most reps at the latest session's top weight. */
  atTop: Best<number[]> | null;
}

export interface ExerciseHistory {
  key: string;
  title: string;
  /** The unit of the latest weighted line; lb when there is none. */
  unit: WeightUnit;
  /** Oldest first. */
  sessions: Session[];
  records: Records;
}

interface Entry {
  date: string;
  lines: LoadLine[];
}

/**
 * Every exercise in `days`, the one done most recently first. `titles` maps a written name's key
 * (an alias, say) to the exercise's title; otherwise the first spelling seen is the title.
 */
export function exerciseHistories(
  days: DayLog[],
  titles: ReadonlyMap<string, string> = new Map(),
): ExerciseHistory[] {
  const groups = new Map<string, { title: string; entries: Entry[] }>();
  for (const day of [...days].sort((a, b) => a.date.localeCompare(b.date))) {
    for (const exercise of day.exercises) {
      const title = titles.get(exerciseKey(exercise.name)) ?? exercise.name;
      const key = exerciseKey(title);
      const group = groups.get(key) ?? { title, entries: [] };
      addEntry(group.entries, day.date, exercise.lines);
      groups.set(key, group);
    }
  }
  return [...groups]
    .map(([key, { title, entries }]) => history(key, title, entries))
    .sort(byLatestThenTitle);
}

/** The same exercise twice in a day is one session. */
function addEntry(entries: Entry[], date: string, lines: LoadLine[]): void {
  const last = entries[entries.length - 1];
  if (last?.date === date) {
    last.lines.push(...lines);
  } else {
    entries.push({ date, lines: [...lines] });
  }
}

function history(key: string, title: string, entries: Entry[]): ExerciseHistory {
  const unit = latestUnit(entries);
  const sessions = entries.map((e) => session(e, unit));
  for (const [i, s] of sessions.entries()) {
    const before = sessions[i - 1];
    s.progress = before ? progress(s, before) : null;
  }
  return { key, title, unit, sessions, records: records(sessions) };
}

function latestUnit(entries: Entry[]): WeightUnit {
  const units = entries.flatMap((e) => e.lines.flatMap((l) => (l.unit === null ? [] : [l.unit])));
  return units[units.length - 1] ?? "lb";
}

function session(entry: Entry, unit: WeightUnit): Session {
  const sets = entry.lines.flatMap((line) =>
    Array.from({ length: line.sets }, () => ({
      weight: convert(line.weight, line.unit, unit),
      reps: line.reps,
      warmUp: line.warmUp,
    })),
  );
  const tagged = sets.filter((s) => !s.warmUp);
  // A log of only warm-ups still says what was lifted.
  const working = tagged.length > 0 ? tagged : sets;
  const topWeight = heaviest(working);
  const repsAtTop = working.filter((s) => sameWeight(s.weight, topWeight)).map((s) => s.reps);
  return {
    date: entry.date,
    sets,
    topWeight,
    repsAtTop,
    est1rm: topWeight === null ? null : topWeight * (1 + mean(repsAtTop) / 30),
    volume: working.reduce((sum, s) => sum + (s.weight ?? 0) * s.reps, 0),
    progress: null,
  };
}

function convert(weight: number | null, from: WeightUnit | null, to: WeightUnit): number | null {
  if (weight === null || from === null || from === to) {
    return weight;
  }
  return to === "lb" ? weight * LB_PER_KG : weight / LB_PER_KG;
}

function heaviest(sets: WorkSet[]): number | null {
  const weights = sets.flatMap((s) => (s.weight === null ? [] : [s.weight]));
  return weights.length > 0 ? Math.max(...weights) : null;
}

function sameWeight(a: number | null, b: number | null): boolean {
  if (a === null || b === null) {
    return a === b;
  }
  return Math.abs(a - b) < SAME_WEIGHT;
}

function mean(values: number[]): number {
  return values.length > 0 ? sum(values) / values.length : 0;
}

function sum(values: number[]): number {
  return values.reduce((total, v) => total + v, 0);
}

/** Heavier wins; at the same weight, more reps at it. */
function progress(now: Session, before: Session): Progress | null {
  if ((now.topWeight === null) !== (before.topWeight === null)) {
    return null;
  }
  if (!sameWeight(now.topWeight, before.topWeight)) {
    return (now.topWeight ?? 0) > (before.topWeight ?? 0) ? "weight" : "down";
  }
  const change = sum(now.repsAtTop) - sum(before.repsAtTop);
  if (change === 0) {
    return "same";
  }
  return change > 0 ? "reps" : "down";
}

function records(sessions: Session[]): Records {
  const top = sessions[sessions.length - 1]?.topWeight ?? null;
  const atTop = sessions.filter((s) => sameWeight(s.topWeight, top));
  return {
    heaviest: best(sessions, (s) => s.topWeight),
    est1rm: best(sessions, (s) => s.est1rm),
    atTop: bestReps(atTop),
  };
}

/** The highest `value`, dated by the first session that reached it. */
function best(sessions: Session[], value: (s: Session) => number | null): Best<number> | null {
  let found: Best<number> | null = null;
  for (const s of sessions) {
    const v = value(s);
    if (v !== null && (found === null || v > found.value + SAME_WEIGHT)) {
      found = { value: v, date: s.date };
    }
  }
  return found;
}

function bestReps(sessions: Session[]): Best<number[]> | null {
  let found: Session | null = null;
  for (const s of sessions) {
    if (found === null || sum(s.repsAtTop) > sum(found.repsAtTop)) {
      found = s;
    }
  }
  return found ? { value: found.repsAtTop, date: found.date } : null;
}

function byLatestThenTitle(a: ExerciseHistory, b: ExerciseHistory): number {
  const latest = (h: ExerciseHistory) => h.sessions[h.sessions.length - 1]?.date ?? "";
  return latest(b).localeCompare(latest(a)) || a.title.localeCompare(b.title);
}
