// The lifting log you write under `## Workouts` in a daily note: one bullet per exercise, in the
// order you did them, with indented `weight, sets×reps` lines. The server only reads it.
//
//   - Chest Press
//       - 60lbs, 1x10
//       - 80lbs, 3x10

import { sectionLines } from "./markdown";

export const LIFTING_SECTION = "Workouts";

export type WeightUnit = "lb" | "kg";

/** One written line: `sets` sets of `reps` at `weight`. Bodyweight lines have no weight. */
export interface LoadLine {
  weight: number | null;
  unit: WeightUnit | null;
  sets: number;
  reps: number;
}

export interface Exercise {
  name: string;
  lines: LoadLine[];
}

/** One set, with the lines expanded. */
export interface LoggedSet {
  exercise: string;
  /** 0-based position of the exercise in the log. */
  exerciseIndex: number;
  weight: number | null;
  unit: WeightUnit | null;
  reps: number;
  /** A first line lighter than the exercise's heaviest. */
  warmUp: boolean;
}

/**
 * A load line: one or more `sets×reps` with an optional weight before or after, such as
 * `60lbs, 1x10`, `1x10, 60lbs`, `7.5 lbs 3 x 10`, `40kg, 3×8`, `15lbs, 2x10, 1x8` (two sets of 10,
 * then one of 8), or bodyweight `3x12`.
 */
const WEIGHT = String.raw`(\d+(?:\.\d+)?)\s*(lbs?|kgs?)\b`;
const GROUPS = String.raw`(\d+\s*[x×]\s*\d+(?:[\s,]+\d+\s*[x×]\s*\d+)*)`;
const LOAD = new RegExp(
  String.raw`^(?:${WEIGHT}[\s,]*${GROUPS}|${GROUPS}(?:[\s,]+${WEIGHT})?)[\s,]*$`,
  "i",
);
const SETS_REPS = /(\d+)\s*[x×]\s*(\d+)/gi;
const BULLET = /^(\s*)[-*+]\s+(.*)$/;

/** The exercises in a note body, in order. Lines that aren't exercises or loads are skipped. */
export function parseLiftingLog(body: string): Exercise[] {
  const exercises: Exercise[] = [];
  for (const line of sectionLines(body, LIFTING_SECTION) ?? []) {
    const bullet = BULLET.exec(line);
    if (!bullet) {
      continue;
    }
    const [, indent = "", text = ""] = bullet;
    const load = LOAD.exec(text.trim());
    const current = exercises[exercises.length - 1];
    if (indent.length > 0 && load && current) {
      current.lines.push(...toLoads(load));
    } else if (indent.length === 0 && !load && text.trim() !== "") {
      exercises.push({ name: text.trim(), lines: [] });
    }
  }
  return exercises.filter((e) => e.lines.length > 0);
}

/** One LoadLine per `sets×reps` group, all at the line's weight. */
function toLoads(match: RegExpExecArray): LoadLine[] {
  const [, before, beforeUnit, beforeGroups, groups = beforeGroups ?? "", after, afterUnit] = match;
  const weight = before ?? after;
  const unit = beforeUnit ?? afterUnit;
  return [...groups.matchAll(SETS_REPS)].map(([, sets, reps]) => ({
    weight: weight === undefined ? null : Number(weight),
    unit: unit === undefined ? null : toUnit(unit),
    sets: Number(sets),
    reps: Number(reps),
  }));
}

function toUnit(written: string): WeightUnit {
  return written.toLowerCase().startsWith("kg") ? "kg" : "lb";
}

/** Every set in log order. */
export function loggedSets(exercises: Exercise[]): LoggedSet[] {
  return exercises.flatMap((e, exerciseIndex) => {
    const heaviest = Math.max(...e.lines.map((l) => l.weight ?? 0));
    return e.lines.flatMap((line, i) =>
      Array.from({ length: line.sets }, () => ({
        exercise: e.name,
        exerciseIndex,
        weight: line.weight,
        unit: line.unit,
        reps: line.reps,
        warmUp: i === 0 && e.lines.length > 1 && (line.weight ?? 0) < heaviest,
      })),
    );
  });
}
