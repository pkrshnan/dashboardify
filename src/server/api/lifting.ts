// LiftingService: each exercise's history and next time from the daily notes, and writing a day's
// log one exercise at a time (docs/lifting.md). The day's log refuses an etag older than its
// `## Workouts`.

import type { DerivedRow } from "../../health/derived-store";
import type { ExerciseNote } from "../../lifting/exercise-notes";
import { rangeOf } from "../../lifting/exercise-notes";
import { type SessionHeartRate, sessionHeartRate } from "../../lifting/heart-rate";
import type { ExerciseHistory, Session, WorkSet } from "../../lifting/history";
import { type DayLift, type LiftingStore, StaleLog } from "../../lifting/lifting-store";
import { exerciseKey } from "../../lifting/names";
import { nextTime, type RepRange } from "../../lifting/next-time";
import { type ExerciseNotes, UnreadableNote } from "../../lifting/note-sync";
import type { WeightUnit } from "../../vault/lifting";
import { fromDateParts, toDateParts } from "./date-time";
import { ApiError, failedPrecondition, invalidArgument } from "./errors";
import type { DateParts } from "./requests";

export interface LiftingDeps {
  notes: ExerciseNotes;
  store: LiftingStore;
  /** The day's sets matched to HR climbs. */
  setsOn: (date: string) => Promise<DerivedRow[]>;
  today: () => string;
}

interface SetInput {
  weight?: number;
  reps?: number;
  warmUp?: boolean;
}

interface LoggedInput {
  name?: string;
  title?: string;
  unit?: string;
  sets?: SetInput[];
}

type Found = { history: ExerciseHistory; note: ExerciseNote | undefined };

const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;

export class LiftingService {
  constructor(private readonly deps: LiftingDeps) {}

  listExercises = async (request: { before?: DateParts }) => {
    const before = request.before?.year ? fromDateParts(request.before) : null;
    const found = (await this.deps.notes.histories()).flatMap((f) => {
      const history = before ? sessionsBefore(f.history, before) : f.history;
      return history.sessions.length > 0 ? [{ ...f, history }] : [];
    });
    return { exercises: await Promise.all(found.map((f) => this.exerciseView(f, true))) };
  };

  getExercise = async (request: { name: string }) =>
    this.exerciseView(await this.find(request.name), false);

  updateExercise = async (request: {
    exercise: { name?: string; repRange?: Partial<RepRange> };
  }) => {
    const found = await this.find(request.exercise.name ?? "");
    const range = checkRange(request.exercise.repRange);
    try {
      await this.deps.notes.setRange(found.history, found.note, range);
    } catch (error) {
      if (error instanceof UnreadableNote) {
        failedPrecondition(error.message);
      }
      throw error;
    }
    return this.getExercise({ name: request.exercise.name ?? "" });
  };

  getWorkoutLog = async (request: { name: string }) => {
    const date = logDate(request.name);
    return logView(await this.deps.store.day(date));
  };

  updateLoggedExercise = async (request: { exercise: LoggedInput; etag?: string }) => {
    const { date, slug } = loggedName(request.exercise.name ?? "");
    const history = await this.historyOf(slug);
    const day = await this.deps.store.day(date);
    const title = titleFor(request.exercise.title, slug, day, history);
    const unit = unitFor(request.exercise.unit, history);
    const sets = (request.exercise.sets ?? []).map(setFrom);
    return logView(
      await this.write(() => this.deps.store.putExercise(date, title, unit, sets, request.etag)),
    );
  };

  deleteLoggedExercise = async (request: { name: string; etag?: string }) => {
    const { date, slug } = loggedName(request.name);
    const key = slug.replace(/-/g, " ");
    const day = await this.deps.store.day(date);
    if (!day.exercises.some((e) => exerciseKey(e.name) === key)) {
      throw notFound(request.name);
    }
    return logView(await this.write(() => this.deps.store.removeExercise(date, key, request.etag)));
  };

  private async find(name: string): Promise<Found> {
    const match = /^exercises\/([a-z0-9-]+)$/.exec(name);
    if (!match?.[1]) {
      invalidArgument("name must be exercises/{exercise}");
    }
    const key = match[1].replace(/-/g, " ");
    const found = (await this.deps.notes.histories()).find((f) => f.history.key === key);
    if (!found) {
      throw notFound(name);
    }
    return found;
  }

  private async historyOf(slug: string): Promise<ExerciseHistory | undefined> {
    const key = slug.replace(/-/g, " ");
    return (await this.deps.notes.histories()).find((f) => f.history.key === key)?.history;
  }

  /** The store's writes with a stale etag as `409`. */
  private async write(fn: () => Promise<DayLift>): Promise<DayLift> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof StaleLog) {
        throw new ApiError(409, error.message, "aborted");
      }
      throw error;
    }
  }

  private async exerciseView({ history, note }: Found, lastOnly: boolean) {
    const range = rangeOf(note, history.unit);
    const newest = [...history.sessions].reverse();
    const shown = lastOnly ? newest.slice(0, 1) : newest;
    const heartRates = await Promise.all(
      shown.map(async (s) => sessionHeartRate(await this.deps.setsOn(s.date), history.key)),
    );
    const next = nextTime(history, range, this.deps.today());
    return {
      name: `exercises/${history.key.replace(/ /g, "-")}`,
      title: history.title,
      aliases: note?.aliases ?? [],
      path: note?.path ?? "",
      unit: history.unit,
      repRange: range,
      sessions: shown.map((s, i) => sessionView(s, heartRates[i] ?? null, history)),
      records: lastOnly ? undefined : recordsView(history),
      nextTime: next ? { sets: next.sets.map(setView), reason: next.reason } : undefined,
    };
  }
}

/** The history as it stood before `date`; records are left as they are. */
function sessionsBefore(history: ExerciseHistory, date: string): ExerciseHistory {
  return { ...history, sessions: history.sessions.filter((s) => s.date < date) };
}

function checkRange(range: Partial<RepRange> | undefined): RepRange {
  const { low, high, step } = range ?? {};
  if (!(low && high && step) || high < low) {
    invalidArgument("repRange needs low ≤ high and a step");
  }
  return { low, high, step };
}

function logDate(name: string): string {
  const match = new RegExp(`^days/${DATE}/lifting$`).exec(name);
  if (!match?.[1]) {
    invalidArgument("name must be days/{day}/lifting");
  }
  return match[1];
}

function loggedName(name: string): { date: string; slug: string } {
  const match = new RegExp(`^days/${DATE}/lifting/exercises/([a-z0-9-]+)$`).exec(name);
  if (!(match?.[1] && match[2])) {
    invalidArgument("name must be days/{day}/lifting/exercises/{exercise}");
  }
  return { date: match[1], slug: match[2] };
}

/** The title sent, else as the day's log or the history writes it. */
function titleFor(
  sent: string | undefined,
  slug: string,
  day: DayLift,
  history: ExerciseHistory | undefined,
): string {
  const key = slug.replace(/-/g, " ");
  const title =
    sent?.trim() || day.exercises.find((e) => exerciseKey(e.name) === key)?.name || history?.title;
  if (!title) {
    invalidArgument("title is needed to add an exercise that hasn't been logged before");
  }
  return title;
}

function unitFor(sent: string | undefined, history: ExerciseHistory | undefined): WeightUnit {
  if (sent === "lb" || sent === "kg") {
    return sent;
  }
  return history?.unit ?? "lb";
}

function setFrom(set: SetInput): WorkSet {
  return { weight: set.weight ?? null, reps: set.reps ?? 0, warmUp: set.warmUp === true };
}

function setView(set: WorkSet) {
  return { weight: set.weight ?? undefined, reps: set.reps, warmUp: set.warmUp };
}

function sessionView(s: Session, hr: SessionHeartRate | null, history: ExerciseHistory) {
  const { heaviest, est1rm, atTop } = history.records;
  const records = [
    ...(heaviest?.date === s.date ? ["heaviest"] : []),
    ...(est1rm?.date === s.date ? ["est_one_rep_max"] : []),
    ...(atTop?.date === s.date ? ["at_top"] : []),
  ];
  return {
    date: toDateParts(s.date),
    sets: s.sets.map(setView),
    topWeight: s.topWeight ?? undefined,
    repsAtTop: s.repsAtTop,
    estOneRepMax: s.est1rm ?? undefined,
    volume: s.volume,
    progress: s.progress ?? "",
    restSeconds: hr?.restSeconds ?? undefined,
    peakHeartRate: hr?.peakHr ?? undefined,
    records,
  };
}

function recordsView(history: ExerciseHistory) {
  const { heaviest, est1rm, atTop } = history.records;
  return {
    heaviest: heaviest?.value,
    heaviestDate: heaviest ? toDateParts(heaviest.date) : undefined,
    estOneRepMax: est1rm?.value,
    estOneRepMaxDate: est1rm ? toDateParts(est1rm.date) : undefined,
    repsAtTop: atTop?.value ?? [],
    repsAtTopDate: atTop ? toDateParts(atTop.date) : undefined,
  };
}

function logView(day: DayLift) {
  return {
    name: `days/${day.date}/lifting`,
    exercises: day.exercises.map((e) => ({
      name: `days/${day.date}/lifting/exercises/${exerciseKey(e.name).replace(/ /g, "-")}`,
      title: e.name,
      unit: e.lines.find((l) => l.unit !== null)?.unit ?? "",
      sets: e.lines.flatMap((l) =>
        Array.from({ length: l.sets }, () => ({
          weight: l.weight ?? undefined,
          reps: l.reps,
          warmUp: l.warmUp,
        })),
      ),
    })),
    etag: day.etag,
  };
}

function notFound(name: string): ApiError {
  return new ApiError(404, `${name} not found`, "not_found");
}
