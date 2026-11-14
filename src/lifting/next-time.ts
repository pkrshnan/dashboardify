// What to do next time, so the log screen opens already filled in. Double progression: add a rep
// to each set until every set reaches the top of the rep range, then add weight and start again
// from the bottom. docs/lifting.md has the rules.

import type { WeightUnit } from "../vault/lifting";
import type { ExerciseHistory, Session, WorkSet } from "./history";

export interface RepRange {
  low: number;
  high: number;
  /** The weight added or taken off, in the exercise's unit. */
  step: number;
}

export type Reason = "more-reps" | "add-weight" | "stuck" | "break";

export interface NextTime {
  /** Warm-ups first, then the working sets. */
  sets: WorkSet[];
  reason: Reason;
}

/** After this many days off, repeat the last session before pushing on. */
const BREAK_DAYS = 21;
/** This many sessions in a row at one weight without more reps is a stall. */
const STALL_SESSIONS = 3;

export function defaultRange(unit: WeightUnit): RepRange {
  return { low: 8, high: 12, step: unit === "kg" ? 2.5 : 5 };
}

/** The suggestion for the session after `history`'s last, on `today`; null with no history. */
export function nextTime(
  history: ExerciseHistory,
  range: RepRange,
  today: string,
): NextTime | null {
  const last = history.sessions[history.sessions.length - 1];
  if (!last) {
    return null;
  }
  const warmUps = last.sets.filter((s) => s.warmUp);
  if (daysBetween(last.date, today) > BREAK_DAYS) {
    return { sets: last.sets, reason: "break" };
  }
  const { weight, reps, reason } = working(history.sessions, last, range);
  return { sets: [...warmUps, ...reps.map((r) => ({ weight, reps: r, warmUp: false }))], reason };
}

function working(sessions: Session[], last: Session, range: RepRange) {
  const top = last.topWeight;
  const reps = last.repsAtTop;
  if (top === null) {
    return { weight: null, reps: reps.map((r) => r + 1), reason: "more-reps" as const };
  }
  if (reps.every((r) => r >= range.high)) {
    return {
      weight: top + range.step,
      reps: reps.map(() => range.low),
      reason: "add-weight" as const,
    };
  }
  if (isStuck(sessions)) {
    const lighter = top - range.step > 0 ? top - range.step : top;
    return { weight: lighter, reps: reps.map(() => range.low), reason: "stuck" as const };
  }
  const more = reps.map((r) => Math.min(r + 1, range.high));
  return { weight: top, reps: more, reason: "more-reps" as const };
}

/** The last few sessions all at one weight, and the reps at it no higher than at the first. */
function isStuck(sessions: Session[]): boolean {
  const recent = sessions.slice(-STALL_SESSIONS);
  const [first] = recent;
  if (recent.length < STALL_SESSIONS || !first || first.topWeight === null) {
    return false;
  }
  const sameWeight = recent.every((s) => s.topWeight === first.topWeight);
  const total = (s: Session) => s.repsAtTop.reduce((a, b) => a + b, 0);
  return sameWeight && recent.every((s) => total(s) <= total(first));
}

function daysBetween(from: string, to: string): number {
  return (Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000;
}
