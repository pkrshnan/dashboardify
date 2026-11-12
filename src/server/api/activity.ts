import { defined } from "../../defined";
import type { DerivedRow, DerivedStore } from "../../health/derived-store";
import type { RawStore } from "../../health/raw-store";
import { editNote } from "../../vault/markdown";
import { isIsoDate, localTime } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import { type ReviewKind, writeReview } from "../../vault/workout-reviews";
import { fromDateParts, toDateParts } from "./date-time";
import { emptyDay } from "./days";
import { ApiError, invalidArgument } from "./errors";
import type { ApiRequests } from "./requests";

const MAX_DAYS = 92;
const HR_STEP_MS = 15_000;
const HR_MARGIN_MS = 5 * 60_000;
const LB_PER_KG = 2.20462;

export interface ActivityDeps {
  derived: DerivedStore;
  raw: RawStore;
  vault: Vault;
  timeZone: string;
  /** Recomputes a local date's health summary, so a review shows straight away. */
  recompute: (date: string) => Promise<unknown>;
}

/** Workouts, walks, lifting logs and nights from the computed health tables, and reviews. */
export class ActivityService {
  constructor(private readonly deps: ActivityDeps) {}

  listActivityDays = async (request: ApiRequests["listActivityDays"]) => {
    const start = Temporal.PlainDate.from(fromDateParts(request.startDate));
    const end = Temporal.PlainDate.from(fromDateParts(request.endDate));
    const count = start.until(end).days + 1;
    if (count < 1 || count > MAX_DAYS) {
      invalidArgument(`a range is 1 to ${MAX_DAYS} days`);
    }
    const days = [];
    for (let i = 0; i < count; i++) {
      const day = await this.day(start.add({ days: i }).toString());
      if (day) {
        days.push(day);
      }
    }
    return { days };
  };

  getWorkout = async (request: ApiRequests["getWorkout"]) => {
    const { date, row } = await this.find(request.name);
    const start = num(row.start_ts) - HR_MARGIN_MS;
    const end = num(row.end_ts) + HR_MARGIN_MS;
    const samples = await this.deps.raw.readRange("heart_rate", start, end);
    const sets = row.kind === "lifting" ? await this.deps.derived.readAll("sets", date) : [];
    return {
      ...this.workout(date, row),
      heartRate: every(samples, start, end),
      heartRateStartTime: iso(start),
      sets: sets.map(setResource),
    };
  };

  reviewWorkout = async (request: ApiRequests["reviewWorkout"]) => {
    const { date, row } = await this.find(request.name);
    const review = {
      start: this.clock(num(row.start_ts)),
      end: this.clock(num(row.end_ts)),
      kind: request.kind ? (request.kind as ReviewKind) : null,
    };
    await this.deps.vault.update(this.deps.vault.dailyPath(date), (source) =>
      editNote(source, emptyDay(date), (note) => {
        writeReview(note.frontmatter, review);
        return note;
      }),
    );
    await this.deps.recompute(date);
    return this.getWorkout({ name: request.name });
  };

  getNight = async (request: ApiRequests["getNight"]) => {
    const match = /^days\/(\d{4}-\d{2}-\d{2})\/night$/.exec(request.name ?? "");
    if (!(match?.[1] && isIsoDate(match[1]))) {
      invalidArgument("invalid night name");
    }
    const date = defined(match?.[1]);
    const row = await this.deps.derived.read("nights", date);
    if (!row) {
      throw new ApiError(404, "night not found");
    }
    const runs = await this.deps.derived.readAll("stages", date);
    return nightResource(`days/${date}/night`, row, runs);
  };

  private async day(date: string) {
    const summary = await this.deps.derived.read("days", date);
    if (!summary) {
      return null;
    }
    const workouts = await this.deps.derived.readAll("workouts", date);
    const walks = await this.deps.derived.readAll("walks", date);
    const sets = await this.deps.derived.readAll("sets", date);
    return {
      date: toDateParts(date),
      steps: Math.round(num(summary.steps)),
      wornMinutes: Math.round(num(summary.worn_min)),
      workouts: workouts.map((w) => this.workout(date, w)),
      walks: walks.map(walkResource),
      lifting: sets.length > 0 ? liftingLog(sets) : undefined,
    };
  }

  private workout(date: string, row: DerivedRow) {
    return {
      name: `days/${date}/workouts/${this.clock(num(row.start_ts)).replace(":", "")}`,
      kind: String(row.kind),
      status: `WORKOUT_STATUS_${String(row.status ?? "detected").toUpperCase()}`,
      startTime: iso(num(row.start_ts)),
      endTime: iso(num(row.end_ts)),
      durationMinutes: num(row.duration_min),
      averageHeartRate: num(row.avg_hr),
      maxHeartRate: num(row.max_hr),
      cadence: num(row.cadence_spm),
      strain: num(row.strain),
      calories: typeof row.kcal === "number" ? row.kcal : undefined,
      // Rows from before Strava have no such columns; null is "not from Strava" too.
      distanceMeters: typeof row.distance_m === "number" ? row.distance_m : undefined,
      stravaActivityId: typeof row.strava_id === "number" ? row.strava_id : undefined,
    };
  }

  /** The stored workout a name points at, or 404. */
  private async find(name: string): Promise<{ date: string; row: DerivedRow }> {
    const match = /^days\/(\d{4}-\d{2}-\d{2})\/workouts\/(\d{2})(\d{2})$/.exec(name ?? "");
    if (!(match && isIsoDate(match[1]))) {
      invalidArgument("invalid workout name");
    }
    const date = defined(match?.[1]);
    const time = `${match?.[2]}:${match?.[3]}`;
    const rows = await this.deps.derived.readAll("workouts", date);
    const row = rows.find((r) => this.clock(num(r.start_ts)) === time);
    if (!row) {
      throw new ApiError(404, "workout not found");
    }
    return { date, row };
  }

  private clock(ts: number): string {
    return localTime(new Date(ts), this.deps.timeZone);
  }
}

/** Rows from before sleep stages (H9) have no stage columns, so those fields stay unset. */
function nightResource(name: string, row: DerivedRow, runs: DerivedRow[]) {
  return {
    name,
    bedTime: iso(num(row.bed_ts)),
    onsetTime: iso(num(row.onset_ts)),
    wakeTime: iso(num(row.wake_ts)),
    asleepMinutes: num(row.tst_min),
    sleepScore: num(row.sleep_score),
    lightMinutes: optionalNum(row.light_min),
    deepMinutes: optionalNum(row.deep_min),
    remMinutes: optionalNum(row.rem_min),
    stagesPlausible:
      typeof row.stages_plausible === "number" ? row.stages_plausible === 1 : undefined,
    stages: runs.map((r) => ({
      startTime: iso(num(r.start_ts)),
      endTime: iso(num(r.end_ts)),
      stage: STAGES.has(String(r.stage))
        ? `STAGE_${String(r.stage).toUpperCase()}`
        : "STAGE_UNSPECIFIED",
    })),
  };
}

const STAGES = new Set(["awake", "light", "deep", "rem"]);

function walkResource(row: DerivedRow) {
  return {
    startTime: iso(num(row.start_ts)),
    endTime: iso(num(row.end_ts)),
    durationMinutes: num(row.duration_min),
    steps: Math.round(num(row.steps)),
    cadence: num(row.cadence_spm),
    briskMinutes: Math.round(num(row.brisk_min)),
    averageHeartRate: typeof row.avg_hr === "number" ? row.avg_hr : undefined,
  };
}

function liftingLog(sets: DerivedRow[]) {
  return {
    exercises: new Set(sets.map((s) => s.exercise_index)).size,
    sets: sets.length,
    volumePounds: sets.reduce((sum, s) => sum + pounds(s) * num(s.reps), 0),
    matched: sets.every((s) => typeof s.peak_ts === "number"),
  };
}

function setResource(row: DerivedRow) {
  return {
    exercise: String(row.exercise),
    exerciseIndex: Math.round(num(row.exercise_index)),
    weight: typeof row.weight === "number" ? row.weight : undefined,
    unit: typeof row.unit === "string" ? row.unit : "",
    reps: Math.round(num(row.reps)),
    warmUp: row.warm_up === 1,
    startTime: typeof row.start_ts === "number" ? iso(row.start_ts) : undefined,
    peakTime: typeof row.peak_ts === "number" ? iso(row.peak_ts) : undefined,
    peakHeartRate: typeof row.peak_hr === "number" ? row.peak_hr : undefined,
  };
}

function pounds(row: DerivedRow): number {
  const weight = num(row.weight);
  return row.unit === "kg" ? weight * LB_PER_KG : weight;
}

/** Mean HR every 15 seconds from `start` to `end`; 0 where there were no samples. */
function every(samples: { ts: number; bpm?: unknown }[], start: number, end: number): number[] {
  const sums = new Map<number, { sum: number; n: number }>();
  for (const s of samples) {
    if (typeof s.bpm === "number" && s.bpm > 0) {
      const i = Math.floor((s.ts - start) / HR_STEP_MS);
      const acc = sums.get(i) ?? { sum: 0, n: 0 };
      sums.set(i, { sum: acc.sum + s.bpm, n: acc.n + 1 });
    }
  }
  return Array.from({ length: Math.ceil((end - start) / HR_STEP_MS) }, (_, i) => {
    const acc = sums.get(i);
    return acc ? Math.round(acc.sum / acc.n) : 0;
  });
}

function optionalNum(value: unknown): number | undefined {
  return typeof value === "number" ? value : undefined;
}

function num(value: unknown): number {
  return typeof value === "number" ? value : 0;
}

function iso(ts: number): string {
  return new Date(ts).toISOString();
}
