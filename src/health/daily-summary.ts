// Computes one local day's health summary from the raw strap streams and writes it out: the
// computed tables in health-derived/, then the numbers and a Health block in the daily note.
//
// A date's summary covers the night that ended that morning (searched from 6 pm the evening
// before to 2 pm) and the activity of the calendar day itself, midnight to midnight.

import { parseLiftingLog } from "../vault/lifting";
import { localDate, localTime } from "../vault/time";
import type { Vault } from "../vault/vault";
import { readReviews } from "../vault/workout-reviews";
import type { DerivedRow, DerivedStore } from "./derived-store";
import { type LiftingSet, liftingDay } from "./lifting";
import { LOOKBACK_DAYS, type Load, type LoadDay, trainingLoad } from "./metrics/load";
import {
  BASELINE_NIGHTS,
  MIN_BASELINE_NIGHTS,
  type NightSignals,
  recovery,
  tempDeviation,
} from "./metrics/recovery";
import type { RecordedRun } from "./metrics/runs";
import type { EpochFeatures } from "./metrics/sleep-features";
import { DEFAULT_NEED_MIN, type PastNight } from "./metrics/sleep-score";
import {
  type SleepStages,
  type StageModel,
  type StageRun,
  stageModel,
} from "./metrics/sleep-stages";
import { median, round } from "./metrics/stats";
import { stepsPerMinute } from "./metrics/steps";
import {
  type DayMetrics,
  dayMetrics,
  type NightMetrics,
  nightFeatures,
  nightMetrics,
  type Profile,
} from "./metrics/summary";
import type {
  Accel,
  HeartRate,
  Motion,
  RrInterval,
  SkinTemp,
  Span,
  StepCounter,
} from "./metrics/types";
import { RESTING_NIGHTS, vo2max } from "./metrics/vo2max";
import type { Walk } from "./metrics/walks";
import { movingInPlace } from "./metrics/workouts";
import { ParamsStore } from "./params";
import { parseProfile } from "./profile";
import type { RawStore, Row } from "./raw-store";
import { type DaySummary, frontmatter, healthBlock, syncLine } from "./render";
import { counted, type ReviewedWorkout, reviewFor, reviewWorkouts } from "./reviews";

/** Bump when a calculation changes, so old rows can be told apart and rebuilt. */
export const ALGO_VERSION = "16";

/** Strava runs, as strava-cache.db holds them (see src/strava/cache.ts). */
export interface RunSource {
  between(
    from: number,
    to: number,
  ): {
    id: number;
    start: number;
    elapsedSeconds: number;
    distanceMeters: number;
  }[];
}

const noRuns: RunSource = { between: () => [] };

/** How far either way to look for a night with resting HR when there is no recent one. */
const NEAREST_NIGHT_DAYS = 7;

export class DailySummary {
  private readonly params: ParamsStore;

  constructor(
    private readonly raw: RawStore,
    private readonly derived: DerivedStore,
    private readonly vault: Vault,
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
    private readonly runs: RunSource = noRuns,
  ) {
    this.params = new ParamsStore(derived.root);
  }

  /**
   * Compute and write `date`. Resolves to the summary, or null when there was no data; today's
   * note still gets a Health block then, saying when data last arrived.
   */
  async run(date: string): Promise<DaySummary | null> {
    const summary = await this.compute(date);
    const synced = await this.synced(date);
    if (!summary.night && summary.day.wornMin === 0) {
      if (synced) {
        await this.vault.setDailyBlock(date, "health", healthBlock(null, 0, this.clock, synced));
      }
      return null;
    }
    await this.save(date, summary, synced);
    return summary;
  }

  async compute(date: string): Promise<DaySummary> {
    const params = await this.params.load();
    const profileFields = await this.vault.readProfile();
    const rows = await this.history(date);
    const history = rows.map(fromNightRow);
    const night = await this.night(
      date,
      rows,
      needMinutes(profileFields),
      stageModel(params.stages),
    );
    const signals = night ? toSignals(night) : null;
    const heartRate = await this.load(date, "heart_rate", 0, 24, toHeartRate);
    const steps = await this.load(date, "steps", 0, 24, toSteps);
    const motion = await this.load(date, "motion", 0, 24, toMotion);
    const sleep = night ? { start: night.bed, end: night.wake } : null;
    const profile = parseProfile(profileFields, date);
    const day = dayMetrics({
      day: this.daySpan(date),
      heartRate,
      steps,
      motion,
      sleep,
      restingHr: await this.restingHr(date, night, history),
      profile,
      runs: this.dayRuns(date),
    });
    return {
      night,
      day,
      ...(await this.reviewed(date, day, { heartRate, steps, motion, sleep })),
      load: await this.trainingLoad(date, day),
      vo2max: await this.vo2max(date, night, profile),
      recovery: signals ? recovery(signals, history, params.recovery) : null,
      paramsVersion: params.version,
      baselineNights: history.filter((n) => n.lnRmssd !== null).length,
      tempDevC: tempDeviation(signals?.skinTemp ?? null, history),
    };
  }

  /** The day's workouts with your reviews applied, and the note's lifting log joined to them. */
  private async reviewed(
    date: string,
    day: DayMetrics,
    strap: { heartRate: HeartRate[]; steps: StepCounter[]; motion: Motion[]; sleep: Span | null },
  ): Promise<Pick<DaySummary, "workouts" | "lifting">> {
    const note = await this.vault.readDaily(date);
    const reviews = readReviews(note?.frontmatter).map((r) => ({
      span: { start: this.at(date, r.start), end: this.at(date, r.end) },
      kind: r.kind,
    }));
    // A workout you dismissed can't take the day's lifting log.
    const kept = day.workouts.filter((w) => reviewFor(w, reviews)?.kind !== "none");
    const lifting = liftingDay(
      parseLiftingLog(note?.body ?? ""),
      kept,
      movingInPlace(strap.motion, stepsPerMinute(strap.steps), [
        ...(strap.sleep ? [strap.sleep] : []),
        ...kept,
        ...day.walks,
      ]),
      strap.heartRate,
    );
    const workouts = reviewWorkouts(day.workouts, reviews, {
      session: lifting?.found === "workout" ? lifting.session : null,
      logged: lifting !== null,
    });
    return { workouts, lifting };
  }

  /** Load through `date`: the stored days before it, then this run's own TRIMP. */
  private async trainingLoad(date: string, day: DayMetrics): Promise<Load> {
    const start = Temporal.PlainDate.from(date);
    const past: (LoadDay | null)[] = [];
    for (let back = LOOKBACK_DAYS; back >= 1; back--) {
      const row = await this.derived.read("days", start.subtract({ days: back }).toString());
      past.push(row ? toLoadDay(row) : null);
    }
    // Today's TRIMP is still a running total; see trainingLoad.
    const today = date === localDate(new Date(this.now()), this.timeZone);
    return trainingLoad([...past, { trimp: day.trimp, wornMin: day.wornMin }], today);
  }

  /** VO2max on the last 30 nights' resting HR: the stored nights before, then last night's. */
  private async vo2max(
    date: string,
    night: NightMetrics | null,
    profile: Profile,
  ): Promise<number | null> {
    const start = Temporal.PlainDate.from(date);
    const restingHrs: (number | null)[] = [];
    for (let back = RESTING_NIGHTS - 1; back >= 1; back--) {
      const row = await this.derived.read("nights", start.subtract({ days: back }).toString());
      restingHrs.push(typeof row?.rhr_bpm === "number" ? row.rhr_bpm : null);
    }
    restingHrs.push(night?.restingHr ?? null);
    return vo2max({ maxHrMeasured: profile.maxHrMeasured, sex: profile.sex, restingHrs });
  }

  /** Midnight to midnight on `date`, or to now for today: calories are a running total. */
  private daySpan(date: string): Span {
    const midnight = Temporal.PlainDate.from(date).toZonedDateTime(this.timeZone);
    const end = midnight.add({ days: 1 }).epochMilliseconds;
    return { start: midnight.epochMilliseconds, end: Math.min(this.now(), end) };
  }

  /** Runs that start on `date`, local midnight to midnight. */
  private dayRuns(date: string): RecordedRun[] {
    const next = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
    return this.runs.between(this.at(date, "00:00"), this.at(next, "00:00")).map((run) => ({
      start: run.start,
      end: run.start + run.elapsedSeconds * 1000,
      distanceMeters: run.distanceMeters,
      stravaId: run.id,
    }));
  }

  /** A local HH:MM on `date` as epoch ms. */
  private at(date: string, time: string): number {
    return Temporal.PlainDate.from(date)
      .toPlainDateTime(Temporal.PlainTime.from(time))
      .toZonedDateTime(this.timeZone).epochMilliseconds;
  }

  /** The night that ended on `date`'s morning as stage features, for fit-stages.ts. */
  async features(date: string): Promise<EpochFeatures[] | null> {
    return nightFeatures({
      accel: await this.load(date, "accel", -6, 14, toAccel),
      heartRate: await this.load(date, "heart_rate", -6, 14, toHeartRate),
      rr: await this.load(date, "rr_interval", -6, 14, toRr),
    });
  }

  private async night(
    date: string,
    history: DerivedRow[],
    needMin: number,
    model?: StageModel,
  ): Promise<NightMetrics | null> {
    const minutesAfterNoon = (ts: number) => afterNoon(ts, this.timeZone);
    return nightMetrics({
      accel: await this.load(date, "accel", -6, 14, toAccel),
      heartRate: await this.load(date, "heart_rate", -6, 14, toHeartRate),
      rr: await this.load(date, "rr_interval", -6, 14, toRr),
      skinTemp: await this.load(date, "temperature", -6, 14, toSkinTemp),
      past: history.map((row) => toPastNight(row, minutesAfterNoon)).filter((n) => n !== null),
      needMin,
      minutesAfterNoon,
      stageModel: model,
    });
  }

  /**
   * Resting HR for the day's effort: last night's, else the past week's median. With no nights
   * before, as on the first day with data, it takes the closest night's, an earlier one first at
   * the same distance, since a hard day can raise the night after it.
   */
  private async restingHr(
    date: string,
    night: NightMetrics | null,
    history: NightSignals[],
  ): Promise<number | null> {
    const known = night?.restingHr ?? median(recentRestingHrs(history));
    if (known !== null) {
      return known;
    }
    const day = Temporal.PlainDate.from(date);
    for (let away = 1; away <= NEAREST_NIGHT_DAYS; away++) {
      for (const other of [day.subtract({ days: away }), day.add({ days: away })]) {
        const restingHr = await this.nightRestingHr(other.toString());
        if (restingHr !== null) {
          return restingHr;
        }
      }
    }
    return null;
  }

  /** A night's resting HR: stored, or computed from the samples when that day hasn't run yet. */
  private async nightRestingHr(date: string): Promise<number | null> {
    const stored = await this.derived.read("nights", date);
    if (typeof stored?.rhr_bpm === "number") {
      return stored.rhr_bpm;
    }
    return (await this.night(date, [], DEFAULT_NEED_MIN))?.restingHr ?? null;
  }

  /** Earlier nights from the stored nights table, oldest first. */
  private async history(date: string): Promise<DerivedRow[]> {
    const day = Temporal.PlainDate.from(date);
    const rows: DerivedRow[] = [];
    for (let back = BASELINE_NIGHTS; back >= 1; back--) {
      const row = await this.derived.read("nights", day.subtract({ days: back }).toString());
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  /** A stream's rows from `fromHour` to `toHour` local time on `date` (negative = day before). */
  private async load<T>(
    date: string,
    stream: string,
    fromHour: number,
    toHour: number,
    convert: (row: Row) => T | null,
  ): Promise<T[]> {
    const midnight = Temporal.PlainDate.from(date).toZonedDateTime(this.timeZone);
    const from = midnight.add({ hours: fromHour }).epochMilliseconds;
    const to = Math.min(this.now(), midnight.add({ hours: toHour }).epochMilliseconds);
    const rows = await this.raw.readRange(stream, from, to);
    return rows.map(convert).filter((v): v is T => v !== null);
  }

  /** The Synced line for today's note; null on other days and before the first upload. */
  private async synced(date: string): Promise<string | null> {
    const now = this.now();
    const sync =
      date === localDate(new Date(now), this.timeZone) ? await this.raw.readSync() : null;
    if (!sync) {
      return null;
    }
    const when = (ts: number) =>
      localDate(new Date(ts), this.timeZone) === date
        ? this.clock(ts)
        : `${shortDayMonth(ts, this.timeZone)} ${this.clock(ts)}`;
    return syncLine(sync, now, when);
  }

  private readonly clock = (ts: number) => localTime(new Date(ts), this.timeZone);

  private async save(date: string, summary: DaySummary, synced: string | null): Promise<void> {
    const stamp = {
      date,
      algo_version: ALGO_VERSION,
      params_version: summary.paramsVersion,
      computed_at: new Date(this.now()).toISOString(),
    };
    if (summary.night) {
      await this.derived.write("nights", date, { ...stamp, ...nightRow(summary.night) });
    }
    await this.derived.write("days", date, { ...stamp, ...dayRow(summary) });
    await this.derived.writeAll(
      "workouts",
      date,
      summary.workouts.map((w) => ({ ...stamp, ...workoutRow(w) })),
    );
    await this.derived.writeAll(
      "sets",
      date,
      (summary.lifting?.sets ?? []).map((set, i) => ({ ...stamp, ...setRow(set, i) })),
    );
    await this.derived.writeAll(
      "walks",
      date,
      summary.day.walks.map((w) => ({ ...stamp, ...walkRow(w) })),
    );
    await this.derived.writeAll(
      "stages",
      date,
      (summary.night?.stages?.runs ?? []).map((r) => ({ ...stamp, ...stageRow(r) })),
    );
    await this.vault.recordHealth(date, frontmatter(summary), "strap");
    await this.vault.setDailyBlock(
      date,
      "health",
      healthBlock(summary, MIN_BASELINE_NIGHTS, this.clock, synced),
    );
  }
}

/** "3 Nov" in `timeZone`. */
function shortDayMonth(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(ts);
}

function toSignals(night: NightMetrics): NightSignals {
  return {
    lnRmssd: night.lnRmssd,
    restingHr: night.restingHr,
    breathingRate: night.breathingRate,
    skinTemp: night.skinTemp,
    sleepScore: night.sleep.score,
  };
}

/** Base sleep need from profile.md (sleep_need_h), or the default. */
function needMinutes(profile: Record<string, unknown> | null): number {
  const hours = profile?.sleep_need_h;
  return typeof hours === "number" && hours > 0 ? hours * 60 : DEFAULT_NEED_MIN;
}

/** Local clock time as minutes after noon, so a night's times never wrap at midnight. */
function afterNoon(ts: number, timeZone: string): number {
  const time = Temporal.Instant.fromEpochMilliseconds(ts).toZonedDateTimeISO(timeZone);
  return (time.hour * 60 + time.minute + 720) % 1440;
}

function toPastNight(row: DerivedRow, minutesAfterNoon: (ts: number) => number): PastNight | null {
  const { onset_ts: onset, wake_ts: wake, tst_min: asleep } = row;
  if (typeof onset !== "number" || typeof wake !== "number" || typeof asleep !== "number") {
    return null;
  }
  return { onsetMin: minutesAfterNoon(onset), wakeMin: minutesAfterNoon(wake), asleepMin: asleep };
}

function nightRow(night: NightMetrics): DerivedRow {
  return {
    bed_ts: night.bed,
    onset_ts: night.onset,
    wake_ts: night.wake,
    time_in_bed_min: night.inBedMin,
    tst_min: night.asleepMin,
    latency_min: night.latencyMin,
    waso_min: night.wakeAfterOnsetMin,
    awakenings: night.awakenings,
    efficiency_pct: night.efficiency * 100,
    sleep_score: night.sleep.score,
    sleep_need_min: night.sleep.needMin,
    sleep_performance_pct: night.sleep.sufficiency,
    sleep_consistency: night.sleep.consistency,
    rhr_bpm: night.restingHr,
    rmssd_ms: night.rmssdMs,
    ln_rmssd: night.lnRmssd,
    hrv_windows: night.hrvWindows,
    resp_rate_bpm: night.breathingRate,
    skin_temp_c: night.skinTemp,
    light_min: night.stages?.lightMin ?? null,
    deep_min: night.stages?.deepMin ?? null,
    rem_min: night.stages?.remMin ?? null,
    stages_plausible: plausibleFlag(night.stages),
  };
}

function plausibleFlag(stages: SleepStages | null): number | null {
  if (!stages) {
    return null;
  }
  return stages.plausible ? 1 : 0;
}

function stageRow(run: StageRun): DerivedRow {
  return { start_ts: run.start, end_ts: run.end, stage: run.stage };
}

export function fromNightRow(row: DerivedRow): NightSignals {
  const num = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : null);
  return {
    lnRmssd: num("ln_rmssd"),
    restingHr: num("rhr_bpm"),
    breathingRate: num("resp_rate_bpm"),
    skinTemp: num("skin_temp_c"),
    sleepScore: num("sleep_score"),
  };
}

function toLoadDay(row: DerivedRow): LoadDay {
  return {
    trimp: typeof row.trimp === "number" ? row.trimp : null,
    wornMin: typeof row.worn_min === "number" ? row.worn_min : 0,
  };
}

function dayRow(s: DaySummary): DerivedRow {
  const zones = s.day.zoneMin ?? [];
  return {
    recovery_pct: s.recovery?.pct ?? null,
    recovery_score: s.recovery?.score ?? null,
    strain: s.day.strain,
    trimp: s.day.trimp,
    worn_min: s.day.wornMin,
    avg_hr: s.day.avgHr,
    max_hr: s.day.maxHr,
    steps: s.day.steps,
    temp_dev_c: s.tempDevC,
    workout_min: counted(s.workouts).reduce((sum, w) => sum + w.minutes, 0),
    walk_min: s.day.walks.reduce((sum, w) => sum + w.minutes, 0),
    walk_steps: s.day.walks.reduce((sum, w) => sum + w.steps, 0),
    load_acute: s.load.acute,
    load_chronic: s.load.chronic,
    load_ratio: s.load.ratio,
    kcal: roundOrNull(s.day.calories?.kcal),
    active_kcal: roundOrNull(s.day.calories?.activeKcal),
    vo2max: round(s.vo2max, 1),
    ...Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`zone${i + 1}_min`, zones[i] ?? null])),
  };
}

function roundOrNull(value: number | undefined): number | null {
  return value === undefined ? null : Math.round(value);
}

function workoutRow(w: ReviewedWorkout): DerivedRow {
  return {
    status: w.status,
    start_ts: w.start,
    end_ts: w.end,
    kind: w.kind,
    duration_min: w.minutes,
    avg_hr: w.avgHr,
    max_hr: w.maxHr,
    cadence_spm: w.cadence,
    trimp: w.trimp,
    strain: w.strain,
    kcal: w.kcal === null ? null : Math.round(w.kcal),
    distance_m: w.distanceMeters ?? null,
    strava_id: w.stravaId ?? null,
  };
}

function setRow(set: LiftingSet, index: number): DerivedRow {
  return {
    set_index: index,
    exercise: set.exercise,
    exercise_index: set.exerciseIndex,
    weight: set.weight,
    unit: set.unit,
    reps: set.reps,
    warm_up: set.warmUp ? 1 : 0,
    start_ts: set.climb?.start ?? null,
    peak_ts: set.climb?.peak ?? null,
    peak_hr: set.climb?.peakHr ?? null,
  };
}

function walkRow(w: Walk): DerivedRow {
  return {
    start_ts: w.start,
    end_ts: w.end,
    duration_min: w.minutes,
    steps: w.steps,
    cadence_spm: w.cadence,
    brisk_min: w.briskMin,
    avg_hr: w.avgHr,
  };
}

// ---- raw rows to typed samples (rows with a missing or non-numeric value are skipped) ----

function nums(row: Row, keys: string[]): number[] | null {
  const values = keys.map((k) => row[k]);
  return values.every((v) => typeof v === "number") ? (values as number[]) : null;
}

function toHeartRate(row: Row): HeartRate | null {
  const v = nums(row, ["bpm"]);
  return v ? { ts: row.ts, bpm: v[0] ?? 0 } : null;
}

function toRr(row: Row): RrInterval | null {
  const v = nums(row, ["ms"]);
  return v ? { ts: row.ts, ms: v[0] ?? 0 } : null;
}

function toAccel(row: Row): Accel | null {
  const v = nums(row, ["x", "y", "z"]);
  return v ? { ts: row.ts, x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 } : null;
}

function toSkinTemp(row: Row): SkinTemp | null {
  const v = nums(row, ["celsius"]);
  return v ? { ts: row.ts, celsius: v[0] ?? 0 } : null;
}

function toSteps(row: Row): StepCounter | null {
  const v = nums(row, ["count"]);
  return v ? { ts: row.ts, count: v[0] ?? 0 } : null;
}

function toMotion(row: Row): Motion | null {
  const v = nums(row, ["intensity"]);
  return v ? { ts: row.ts, intensity: v[0] ?? 0 } : null;
}

function recentRestingHrs(history: NightSignals[]): number[] {
  return history
    .slice(-7)
    .map((n) => n.restingHr)
    .filter((v): v is number => v !== null);
}
