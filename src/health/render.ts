// What the daily note shows: frontmatter numbers (for Dataview, charts and the API) and a short
// Health block for reading. Units are in the frontmatter key names, so values are plain numbers.

import type { LiftingDay } from "./lifting";
import { type Load, loadBand } from "./metrics/load";
import type { Recovery } from "./metrics/recovery";
import type { SleepStages } from "./metrics/sleep-stages";
import type { DayMetrics, NightMetrics } from "./metrics/summary";
import type { Walk } from "./metrics/walks";
import type { Workout } from "./metrics/workouts";
import { counted, type ReviewedWorkout } from "./reviews";
import { type HealthSync, lag, shortDuration } from "./sync";

export interface DaySummary {
  night: NightMetrics | null;
  day: DayMetrics;
  recovery: Recovery | null;
  /** Nights of history so far, for "calibrating" until there are enough. */
  baselineNights: number;
  tempDevC: number | null;
  /** Which params file version scored this day (see params.ts). */
  paramsVersion: string;
  /** The day's workouts with your reviews applied; dismissed ones are kept but not shown. */
  workouts: ReviewedWorkout[];
  /** The note's lifting log, joined to the strap; null without a log. */
  lifting: LiftingDay | null;
  load: Load;
  /** ml/kg/min; null without a measured max HR or enough nights. */
  vo2max: number | null;
}

type Fields = Record<string, number | null | undefined>;

/** Frontmatter keys from the health data contract. Missing values are left out. */
export function frontmatter(s: DaySummary): Record<string, number> {
  const fields: Fields = {
    recovery_pct: round(s.recovery?.pct, 0),
    strain: round(s.day.strain, 1),
    load_acute: round(s.load.acute, 1),
    load_chronic: round(s.load.chronic, 1),
    load_ratio: round(s.load.ratio, 2),
    kcal: round(s.day.calories?.kcal, 0),
    active_kcal: round(s.day.calories?.activeKcal, 0),
    vo2max: round(s.vo2max, 0),
    sleep_score: round(s.night?.sleep.score, 0),
    sleep_performance_pct: round(s.night?.sleep.sufficiency, 0),
    tst_min: round(s.night?.asleepMin, 0),
    deep_min: round(s.night?.stages?.deepMin, 0),
    rem_min: round(s.night?.stages?.remMin, 0),
    light_min: round(s.night?.stages?.lightMin, 0),
    rhr_bpm: round(s.night?.restingHr, 0),
    rmssd_ms: round(s.night?.rmssdMs, 0),
    resp_rate_bpm: round(s.night?.breathingRate, 1),
    temp_dev_c: round(s.tempDevC, 2),
    steps: s.day.steps > 0 ? s.day.steps : null,
  };
  return Object.fromEntries(
    Object.entries(fields).filter(
      (entry): entry is [string, number] => typeof entry[1] === "number",
    ),
  );
}

function round(value: number | null | undefined, digits: number): number | null {
  if (value === null || value === undefined) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}

/**
 * The Health block for the daily note. `clock` formats an epoch-ms time as local HH:MM. `synced`
 * is the last line, today only; without a summary the block is just that line.
 */
export function healthBlock(
  s: DaySummary | null,
  needed: number,
  clock: (ts: number) => string,
  synced: string | null = null,
): string {
  const lines = s
    ? [
        recoveryLine(s, needed),
        ...(s.night ? nightLines(s.night, s.tempDevC, clock) : []),
        strainLine(s.day),
        loadLine(s.load),
        caloriesLine(s.day),
        vo2maxLine(s.vo2max),
        ...counted(s.workouts).map((w) => workoutLine(w, clock)),
        ...s.day.walks.map((w) => walkLine(w, clock)),
        s.lifting ? liftingLine(s.lifting, clock) : null,
        s.day.steps > 0 ? `- Steps ${s.day.steps.toLocaleString("en-US")}` : null,
      ]
    : [];
  return ["## Health", "", ...[...lines, synced].filter((l): l is string => l !== null)].join("\n");
}

/** "- Synced 14:02", plus how far behind once the data lags. `when` formats the sample time. */
export function syncLine(sync: HealthSync, now: number, when: (ts: number) => string): string {
  const behind = lag(sync.latestSampleTs, now);
  const line = `- Synced ${when(sync.latestSampleTs)}`;
  return behind === null ? line : `${line} · **${shortDuration(behind)} behind**`;
}

function recoveryLine(s: DaySummary, needed: number): string {
  if (s.recovery) {
    return `- Recovery **${Math.round(s.recovery.pct)}%**`;
  }
  return `- Recovery calibrating, ${Math.min(s.baselineNights, needed)}/${needed} nights`;
}

function nightLines(
  night: NightMetrics,
  tempDevC: number | null,
  clock: (ts: number) => string,
): (string | null)[] {
  return [
    sleepLine(night, clock),
    night.stages ? stagesLine(night.stages) : null,
    vitalsLine(night, tempDevC),
  ];
}

function sleepLine(night: NightMetrics, clock: (ts: number) => string): string {
  const score = Math.round(night.sleep.score);
  const slept = `${duration(night.asleepMin)} of ${duration(night.sleep.needMin)}`;
  return `- Sleep **${score}** · ${slept} · ${clock(night.onset)}–${clock(night.wake)}`;
}

/** "- Deep 1h 25m · REM 1h 40m · Light 4h 07m", ending "· unusual" when not plausible. */
function stagesLine(stages: SleepStages): string {
  const line = `- Deep ${duration(stages.deepMin)} · REM ${duration(stages.remMin)} · Light ${duration(stages.lightMin)}`;
  return stages.plausible ? line : `${line} · unusual`;
}

function vitalsLine(night: NightMetrics, tempDevC: number | null): string {
  const parts = [
    night.restingHr === null ? null : `RHR ${Math.round(night.restingHr)}`,
    night.rmssdMs === null ? null : `HRV ${Math.round(night.rmssdMs)} ms`,
    night.breathingRate === null ? null : `Breathing ${night.breathingRate.toFixed(1)}`,
    tempDevC === null ? null : `Skin ${signed(tempDevC)} °C`,
  ];
  return `- ${parts.filter((p) => p !== null).join(" · ")}`;
}

function strainLine(day: DayMetrics): string | null {
  if (day.strain === null || day.zoneMin === null) {
    return day.wornMin > 0 ? `- Worn ${duration(day.wornMin)}` : null;
  }
  return `- Strain **${day.strain.toFixed(1)}** · Zones ${day.zoneMin.join(" / ")} min`;
}

/** "- Load steady · 1.08 (7 d vs 28 d)". The band is read from the ratio as shown. */
function loadLine(load: Load): string | null {
  const ratio = round(load.ratio, 2);
  if (ratio === null) {
    return null;
  }
  return `- Load ${loadBand(ratio)} · ${ratio.toFixed(2)} (7 d vs 28 d)`;
}

/** "- Calories 2,640 · 610 active" */
function caloriesLine(day: DayMetrics): string | null {
  if (!day.calories) {
    return null;
  }
  const kcal = (n: number) => Math.round(n).toLocaleString("en-US");
  return `- Calories ${kcal(day.calories.kcal)} · ${kcal(day.calories.activeKcal)} active`;
}

/** "- VO2max 57 (estimate)". Its error is ±10–15%, so a decimal would claim too much. */
function vo2maxLine(vo2max: number | null): string | null {
  return vo2max === null ? null : `- VO2max ${Math.round(vo2max)} (estimate)`;
}

const KIND_NAMES: Record<Workout["kind"], string> = {
  running: "Running",
  walking: "Walking",
  volleyball: "Volleyball",
  lifting: "Lifting",
  workout: "Workout",
};

/**
 * "- Volleyball 20:30–21:15 · 45 min · 138 avg / 179 max · strain 8.3 · 410 kcal"; a Strava run
 * adds "· 5.1 km · 6:16 /km" after the minutes.
 */
function workoutLine(w: ReviewedWorkout, clock: (ts: number) => string): string {
  const hr = `${Math.round(w.avgHr)} avg / ${Math.round(w.maxHr)} max`;
  const when = `${clock(w.start)}–${clock(w.end)}`;
  const name = `${KIND_NAMES[w.kind]}${w.status === "possible" ? "?" : ""}`;
  const parts = [`${name} ${when}`, `${Math.round(w.minutes)} min`];
  if (w.distanceMeters) {
    parts.push(
      `${(w.distanceMeters / 1000).toFixed(1)} km`,
      `${pace(w.minutes, w.distanceMeters)} /km`,
    );
  }
  parts.push(...(w.avgHr > 0 ? [hr] : []), `strain ${w.strain.toFixed(1)}`);
  if (w.kcal !== null) {
    parts.push(`${Math.round(w.kcal).toLocaleString("en-US")} kcal`);
  }
  return `- ${parts.join(" · ")}`;
}

/** Minutes per km as "6:16". */
function pace(minutes: number, meters: number): string {
  const seconds = Math.round((minutes * 60) / (meters / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/**
 * "- Lifting log · 3 exercises · 12 sets · 4,650 lb · sets matched 18:02–19:05", or "· not
 * matched to the strap" when no session or not every set's climb was found.
 */
function liftingLine(l: LiftingDay, clock: (ts: number) => string): string {
  const volume = `${Math.round(l.volumeLb).toLocaleString("en-US")} lb`;
  const log = `- Lifting log · ${count(l.exercises, "exercise")} · ${count(l.sets.length, "set")} · ${volume}`;
  const first = l.sets[0]?.climb;
  const last = l.sets[l.sets.length - 1]?.climb;
  return l.matched && first && last
    ? `${log} · sets matched ${clock(first.start)}–${clock(last.peak)}`
    : `${log} · not matched to the strap`;
}

/** "- Walk 16:01–16:28 · 27 min · 2,790 steps · 104 spm" */
function walkLine(w: Walk, clock: (ts: number) => string): string {
  const steps = `${w.steps.toLocaleString("en-US")} steps · ${Math.round(w.cadence)} spm`;
  return `- Walk ${clock(w.start)}–${clock(w.end)} · ${Math.round(w.minutes)} min · ${steps}`;
}

function count(n: number, noun: string): string {
  return `${n} ${noun}${n === 1 ? "" : "s"}`;
}

function duration(minutes: number): string {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function signed(value: number): string {
  const text = value.toFixed(1);
  return value >= 0 ? `+${text}` : text;
}
