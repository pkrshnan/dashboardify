// The Activity page's data: days of workouts and walks, and how they add up over a week, a month or
// three months. Dates are YYYY-MM-DD strings in the server's time zone; times are epoch ms.

export type Range = "week" | "month" | "3m";

export type WorkoutStatus = "detected" | "possible" | "confirmed" | "dismissed";

export interface WorkoutView {
  /** `days/{date}/workouts/{HHMM}`. */
  name: string;
  kind: string;
  status: WorkoutStatus;
  start: number;
  end: number;
  minutes: number;
  avgHr: number;
  maxHr: number;
  strain: number;
  /** Runs recorded in Strava only. */
  distanceMeters?: number;
  stravaActivityId?: string;
}

export interface WalkView {
  start: number;
  end: number;
  minutes: number;
  steps: number;
  cadence: number;
  briskMin: number;
}

export interface LiftingView {
  exercises: number;
  sets: number;
  volumeLb: number;
  matched: boolean;
}

export interface ActivityDayView {
  date: string;
  steps: number;
  wornMin: number;
  workouts: WorkoutView[];
  walks: WalkView[];
  lifting: LiftingView | null;
}

export interface SetView {
  exercise: string;
  exerciseIndex: number;
  weight: number | null;
  unit: string;
  reps: number;
  warmUp: boolean;
  start: number | null;
  peak: number | null;
  peakHr: number | null;
}

export interface WorkoutDetail extends WorkoutView {
  /** Mean HR every 15 seconds from `heartRateStart`; 0 where the strap had nothing. */
  heartRate: number[];
  heartRateStart: number;
  sets: SetView[];
}

/** What a review can say a workout was, with "none" for not a workout. */
export const REVIEW_CHOICES = ["lifting", "volleyball", "running", "walking", "workout"] as const;

const NAMES: Record<string, string> = {
  running: "Running",
  walking: "Walking",
  volleyball: "Volleyball",
  lifting: "Lifting",
  workout: "Workout",
};

const DAY_MS = 86_400_000;

/** "Lifting", or "Lifting?" while it's only possible. */
export function workoutName(w: Pick<WorkoutView, "kind" | "status">): string {
  const name = NAMES[w.kind] ?? "Workout";
  return w.status === "possible" ? `${name}?` : name;
}

export function kindLabel(kind: string): string {
  return NAMES[kind] ?? kind;
}

/** "45m", "1h 05m". */
export function duration(minutes: number): string {
  const total = Math.round(minutes);
  return total < 60
    ? `${total}m`
    : `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

/** "5.1 km". */
export function distance(meters: number): string {
  return `${(meters / 1000).toFixed(1)} km`;
}

/** Minutes per km, "6:16 /km". Over elapsed time, as the daily note's line is. */
export function pace(minutes: number, meters: number): string {
  const seconds = Math.round((minutes * 60) / (meters / 1000));
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")} /km`;
}

/** The Strava activity's page. */
export function stravaUrl(id: string): string {
  return `https://www.strava.com/activities/${id}`;
}

export function addDays(date: string, days: number): string {
  return new Date(Date.parse(`${date}T00:00:00Z`) + days * DAY_MS).toISOString().slice(0, 10);
}

/** Monday of the week `date` falls in. */
export function monday(date: string): string {
  const dow = (new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7;
  return addDays(date, -dow);
}

/** The days a range covers, ending today: 7 days, 30 days, or the 13 weeks to this one. */
export function rangeDates(today: string, range: Range): { start: string; end: string } {
  if (range === "week") {
    return { start: addDays(today, -6), end: today };
  }
  if (range === "month") {
    return { start: addDays(today, -29), end: today };
  }
  return { start: addDays(monday(today), -12 * 7), end: today };
}

export function datesFrom(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let d = start; d <= end; d = addDays(d, 1)) {
    dates.push(d);
  }
  return dates;
}

export interface Totals {
  workouts: number;
  workoutMin: number;
  toConfirm: number;
  walks: number;
  walkMin: number;
  walkSteps: number;
  steps: number;
  briskMin: number;
  daysWithData: number;
  /** Runs recorded in Strava. */
  runs: number;
  runMeters: number;
  runMin: number;
}

/** What the days add up to. Dismissed workouts don't count. */
export function totals(days: ActivityDayView[]): Totals {
  const workouts = days.flatMap((d) => d.workouts).filter((w) => w.status !== "dismissed");
  const walks = days.flatMap((d) => d.walks);
  const sum = <T>(items: T[], value: (item: T) => number) =>
    items.reduce((total, item) => total + value(item), 0);
  const runs = workouts.filter((w) => w.distanceMeters);
  return {
    workouts: workouts.length,
    workoutMin: sum(workouts, (w) => w.minutes),
    toConfirm: workouts.filter((w) => w.status === "possible").length,
    walks: walks.length,
    walkMin: sum(walks, (w) => w.minutes),
    walkSteps: sum(walks, (w) => w.steps),
    steps: sum(days, (d) => d.steps),
    briskMin: sum(walks, (w) => w.briskMin),
    daysWithData: days.length,
    runs: runs.length,
    runMeters: sum(runs, (w) => w.distanceMeters ?? 0),
    runMin: sum(runs, (w) => w.minutes),
  };
}

/** Monday-first weeks covering `start` to `end`; days outside the range are null. */
export function calendarWeeks(start: string, end: string): (string | null)[][] {
  const weeks: (string | null)[][] = [];
  for (let first = monday(start); first <= end; first = addDays(first, 7)) {
    weeks.push(
      Array.from({ length: 7 }, (_, i) => {
        const date = addDays(first, i);
        return date >= start && date <= end ? date : null;
      }),
    );
  }
  return weeks;
}

export interface WeekMinutes {
  /** Monday. */
  start: string;
  workoutMin: number;
  walkMin: number;
  /** Whether any day of the week had strap data. */
  hasData: boolean;
}

/** Workout and walk minutes for each Monday-first week from `start` to `end`. */
export function weeklyMinutes(days: ActivityDayView[], start: string, end: string): WeekMinutes[] {
  return calendarWeeks(start, end).map((week) => {
    const inWeek = days.filter((d) => week.includes(d.date));
    const t = totals(inWeek);
    return {
      start: monday(week.find((d) => d !== null) ?? start),
      workoutMin: t.workoutMin,
      walkMin: t.walkMin,
      hasData: inWeek.length > 0,
    };
  });
}

/**
 * SVG polyline points for 15-second HR, one line per stretch with data: a gap where the strap had
 * nothing breaks the line rather than drawing across it. Each point sits mid-step.
 */
export function heartRateLines(
  heartRate: number[],
  start: number,
  x: (ms: number) => number,
  y: (bpm: number) => number,
): string[] {
  const lines: string[][] = [[]];
  heartRate.forEach((bpm, i) => {
    const current = lines[lines.length - 1] ?? [];
    if (bpm > 0) {
      current.push(`${x(start + i * 15_000 + 7_500).toFixed(1)},${y(bpm).toFixed(1)}`);
    } else if (current.length > 0) {
      lines.push([]);
    }
  });
  return lines.filter((l) => l.length > 1).map((l) => l.join(" "));
}

/** Round heart rates for the chart's scale, strictly inside lo–hi: every 10, 20 or 40 bpm. */
export function heartRateTicks(lo: number, hi: number): number[] {
  const step = [10, 20].find((s) => hi - lo <= s * 6) ?? 40;
  const ticks: number[] = [];
  for (let bpm = Math.floor(lo / step) * step + step; bpm < hi; bpm += step) {
    ticks.push(bpm);
  }
  return ticks;
}
