// Three months of made-up workouts and walks for the demo's Activity page: runs on Tuesdays,
// Thursdays and Saturdays, lifting on Mondays, volleyball on Wednesdays, and an unnamed workout on
// Fridays that the strap wasn't sure of; Saturday's run is from Strava, walked to and from. Older Fridays are already reviewed in their daily notes;
// the last two, and this morning's gym session, are left to review. Each workout has heart rate,
// so its chart draws, and reviews are applied to these rows rather than recomputed from the strap.

import type { DerivedRow, DerivedStore } from "../src/health/derived-store";
import type { RawStore } from "../src/health/raw-store";
import { type Review, reviewFor, type WorkoutStatus } from "../src/health/reviews";
import type { Sample } from "../src/health/samples";
import { editNote } from "../src/vault/markdown";
import { localTime } from "../src/vault/time";
import type { Vault } from "../src/vault/vault";
import { type ReviewKind, readReviews, writeReview } from "../src/vault/workout-reviews";

const DAYS = 97;
const HR_STEP_MS = 5_000;
const MARGIN_MS = 5 * 60_000;

interface Plan {
  kind: string;
  status: WorkoutStatus;
  /** Local start hour, e.g. 18.5 for 18:30. */
  from: number;
  minutes: number;
  /** Heart rate at each second into the workout. */
  heartRate: (second: number) => number;
  sets?: SetPlan[];
  /** Recorded in Strava, with a walk either side. */
  meters?: number;
}

interface SetPlan {
  exercise: string;
  weight?: number;
  reps: number;
  warmUp: boolean;
}

interface Options {
  derived: DerivedStore;
  raw: RawStore;
  vault: Vault;
  timeZone: string;
  today: Temporal.PlainDate;
  /** Workouts and walks ending after this are left out. */
  now: number;
}

interface Reviewed {
  date: string;
  start: number;
  end: number;
  kind: ReviewKind;
}

/**
 * Writes the workouts, walks and lifting sets for the last three months, with heart rate for
 * each workout. Its `recompute` applies a daily note's reviews to the day's workouts.
 */
export class DemoActivity {
  private readonly noise = seeded(11);
  /** Each day's workouts as the strap found them, before reviews. */
  private readonly found = new Map<string, DerivedRow[]>();
  /** Heart rate by UTC day, as the raw store keeps it. */
  private readonly heartRate = new Map<string, Sample[]>();
  private readonly reviewed: Reviewed[] = [];

  constructor(private readonly opts: Options) {}

  async write(): Promise<void> {
    for (let back = DAYS - 1; back >= 0; back--) {
      await this.writeDay(back);
    }
    for (const [utc, samples] of this.heartRate) {
      await this.opts.raw.store("heart_rate", utc, { header: ["ts", "bpm"], samples });
    }
    for (const review of this.reviewed) {
      await this.writeReview(review);
      await this.recompute(review.date);
    }
  }

  recompute = async (date: string): Promise<void> => {
    const note = await this.opts.vault.readDaily(date);
    const reviews: Review[] = readReviews(note?.frontmatter).map((r) => ({
      span: { start: this.at(date, hours(r.start)), end: this.at(date, hours(r.end)) },
      kind: r.kind,
    }));
    const rows = (this.found.get(date) ?? []).map((row) => {
      const review = reviewFor({ start: Number(row.start_ts), end: Number(row.end_ts) }, reviews);
      if (!review) {
        return row;
      }
      return review.kind === "none"
        ? { ...row, status: "dismissed" }
        : { ...row, kind: review.kind, status: "confirmed" };
    });
    await this.opts.derived.writeAll("workouts", date, rows);
  };

  private async writeDay(back: number): Promise<void> {
    const date = this.opts.today.subtract({ days: back });
    const day = date.toString();
    const plans = back === 0 ? [gymThisMorning(this.noise)] : weekday(date.dayOfWeek, this.noise);
    const timed = plans
      .map((plan) => {
        const start = this.at(day, plan.from);
        return { plan, start, end: start + plan.minutes * 60_000 };
      })
      .filter(({ end }) => end <= this.opts.now);
    const rows = timed.map(({ plan, start, end }) => this.workout(plan, start, end));
    const sets = timed.flatMap(({ plan, start }) =>
      setRows(plan.sets ?? [], start, plan.heartRate),
    );
    // Fridays over two weeks back are already reviewed: alternately a workout, and not one.
    if (back >= 14) {
      for (const { start, end } of timed.filter((t) => t.plan.kind === "workout")) {
        this.reviewed.push({ date: day, start, end, kind: back % 14 < 7 ? "workout" : "none" });
      }
    }
    this.found.set(day, rows);
    await this.opts.derived.writeAll("workouts", day, rows);
    await this.opts.derived.writeAll("sets", day, sets);
    const dayWalks = [
      ...walks(date, (hour) => this.at(day, hour), this.noise),
      ...timed.filter((t) => t.plan.meters).flatMap(({ start, end }) => outingWalks(start, end)),
    ];
    await this.opts.derived.writeAll(
      "walks",
      day,
      dayWalks.filter((w) => w.end_ts <= this.opts.now),
    );
  }

  /** The workout's row, keeping its heart rate to store. */
  private workout(plan: Plan, start: number, end: number): DerivedRow {
    const bpm = samples(start, end, plan.heartRate);
    for (const sample of bpm) {
      const utc = new Date(sample.ts).toISOString().slice(0, 10);
      this.heartRate.set(utc, [...(this.heartRate.get(utc) ?? []), sample]);
    }
    const during = bpm.filter((s) => s.ts >= start && s.ts < end).map((s) => Number(s.values[0]));
    const avgHr = Math.round(during.reduce((sum, v) => sum + v, 0) / during.length);
    return {
      status: plan.status,
      start_ts: start,
      end_ts: end,
      kind: plan.kind,
      duration_min: plan.minutes,
      avg_hr: avgHr,
      max_hr: Math.max(...during),
      cadence_spm: plan.kind === "running" ? Math.round(162 + 8 * this.noise()) : 0,
      strain: round1(strainFor(plan) + this.noise()),
      kcal: kcalFor(plan.minutes, avgHr),
      distance_m: plan.meters ?? null,
      strava_id: plan.meters ? 16_000_000_000 + (Math.round(start / 60_000) % 1_000_000) : null,
    };
  }

  private writeReview(r: Reviewed): Promise<boolean> {
    const { vault } = this.opts;
    const empty = { frontmatter: { date: r.date, tags: ["daily"] }, body: `# ${r.date}\n` };
    return vault.update(vault.dailyPath(r.date), (text) =>
      editNote(text, empty, (note) => {
        writeReview(note.frontmatter, {
          start: this.clock(r.start),
          end: this.clock(r.end),
          kind: r.kind,
        });
        return note;
      }),
    );
  }

  /** A local hour on `date` as epoch ms. */
  private at(date: string, hour: number): number {
    return Temporal.PlainDate.from(date).toZonedDateTime({
      timeZone: this.opts.timeZone,
      plainTime: { hour: Math.floor(hour), minute: Math.round((hour % 1) * 60) },
    }).epochMilliseconds;
  }

  private clock(ts: number): string {
    return localTime(new Date(ts), this.opts.timeZone);
  }
}

/** The week's plan for an ISO day of the week, 1 for Monday. */
function weekday(dayOfWeek: number, noise: () => number): Plan[] {
  switch (dayOfWeek) {
    case 1:
      return [lifting(18, noise)];
    case 2:
      return [easyRun(7, 35 + Math.round(10 * noise()), noise)];
    case 3:
      return [volleyball(19.5, noise)];
    case 4:
      return [intervals(7, noise)];
    case 5:
      return [unsure(17.5, noise)];
    case 6:
      return [stravaRun(9, 32 + Math.round(8 * noise()), noise)];
    default:
      return [];
  }
}

function easyRun(from: number, minutes: number, noise: () => number): Plan {
  const steady = 148 + 6 * noise();
  return {
    kind: "running",
    status: "detected",
    from,
    minutes,
    heartRate: (s) => ramp(s, 95, steady, 300) + 4 * Math.sin(s / 90) + wobble(s),
  };
}

/** A run you recorded in Strava, about 6:10 a km, walked to and from. */
function stravaRun(from: number, minutes: number, noise: () => number): Plan {
  return {
    ...easyRun(from, minutes, noise),
    status: "confirmed",
    meters: Math.round((minutes / (6.1 + 0.3 * noise())) * 1000),
  };
}

/** The walks to and from a Strava run, as the strap's steps find them. */
function outingWalks(start: number, end: number): { start_ts: number; end_ts: number }[] {
  const spans: [number, number][] = [
    [start - 15 * 60_000, start],
    [end, end + 16 * 60_000],
  ];
  return spans.map(([from, to]) => {
    const minutes = (to - from) / 60_000;
    return {
      start_ts: from,
      end_ts: to,
      duration_min: minutes,
      steps: Math.round(minutes * 106),
      cadence_spm: 106,
      brisk_min: minutes - 2,
      avg_hr: 112,
    };
  });
}

/** 6 × 4 minutes hard, 2 easy, after a 10-minute warm-up. */
function intervals(from: number, noise: () => number): Plan {
  const hard = 168 + 4 * noise();
  return {
    kind: "running",
    status: "detected",
    from,
    minutes: 50,
    heartRate: (s) => {
      if (s < 600 || s >= 600 + 6 * 360) {
        return ramp(s, 95, 140, 300) + wobble(s);
      }
      const into = (s - 600) % 360;
      return (into < 240 ? ramp(into, 135, hard, 60) : ramp(into - 240, hard, 132, 45)) + wobble(s);
    },
  };
}

function volleyball(from: number, noise: () => number): Plan {
  const peak = 160 + 5 * noise();
  return {
    kind: "volleyball",
    status: "detected",
    from,
    minutes: 85 + Math.round(10 * noise()),
    // Rallies every minute or so, with breaks between games.
    heartRate: (s) => {
      const rally = Math.max(0, Math.sin(s / 11)) * (s % 1500 < 1320 ? 1 : 0.2);
      return ramp(s, 90, 118, 240) + (peak - 118) * rally ** 2 + wobble(s);
    },
  };
}

/** Something the strap couldn't name, around climbing time. */
function unsure(from: number, noise: () => number): Plan {
  return {
    kind: "workout",
    status: "possible",
    from,
    minutes: 40 + Math.round(10 * noise()),
    heartRate: (s) => ramp(s, 90, 125, 300) + 18 * Math.max(0, Math.sin(s / 70)) + wobble(s),
  };
}

const SESSION: SetPlan[] = [
  { exercise: "Back squat", weight: 135, reps: 8, warmUp: true },
  { exercise: "Back squat", weight: 205, reps: 5, warmUp: false },
  { exercise: "Back squat", weight: 205, reps: 5, warmUp: false },
  { exercise: "Back squat", weight: 205, reps: 5, warmUp: false },
  { exercise: "Bench press", weight: 95, reps: 8, warmUp: true },
  { exercise: "Bench press", weight: 155, reps: 6, warmUp: false },
  { exercise: "Bench press", weight: 155, reps: 6, warmUp: false },
  { exercise: "Romanian deadlift", weight: 70, reps: 8, warmUp: false },
  { exercise: "Romanian deadlift", weight: 70, reps: 8, warmUp: false },
  { exercise: "Pull-up", reps: 8, warmUp: false },
  { exercise: "Pull-up", reps: 7, warmUp: false },
];
const SET_EVERY_S = 240;
const SET_LENGTH_S = 45;

/** A logged session, matched to the climbs in heart rate, so it's confirmed. */
function lifting(from: number, noise: () => number): Plan {
  const base = 98 + 4 * noise();
  return {
    kind: "lifting",
    status: "confirmed",
    from,
    minutes: Math.ceil((SESSION.length * SET_EVERY_S + 120) / 60),
    heartRate: (s) => liftingHeartRate(s, base),
    sets: SESSION,
  };
}

/** This morning's gym session, as on the calendar, with nothing logged: worth asking about. */
function gymThisMorning(noise: () => number): Plan {
  const base = 100 + 4 * noise();
  return {
    kind: "lifting",
    status: "possible",
    from: 8,
    minutes: 52,
    heartRate: (s) => liftingHeartRate(s, base),
  };
}

/** A climb to a peak at the end of each set, then a slow fall through the rest. */
function liftingHeartRate(second: number, base: number): number {
  const into = (second - 60) % SET_EVERY_S;
  const index = Math.floor((second - 60) / SET_EVERY_S);
  if (second < 60 || index >= SESSION.length) {
    return base + wobble(second);
  }
  const peak = base + 38 + (index % 4) * 4;
  const bpm =
    into < SET_LENGTH_S
      ? ramp(into, base + 8, peak, SET_LENGTH_S)
      : base + (peak - base) * Math.exp(-(into - SET_LENGTH_S) / 50);
  return bpm + wobble(second) / 2;
}

function setRows(sets: SetPlan[], start: number, heartRate: (s: number) => number): DerivedRow[] {
  const exercises = [...new Set(sets.map((s) => s.exercise))];
  return sets.map((set, i) => {
    const setStart = start + (60 + i * SET_EVERY_S) * 1000;
    const peak = setStart + SET_LENGTH_S * 1000;
    return {
      set_index: i,
      exercise: set.exercise,
      exercise_index: exercises.indexOf(set.exercise),
      weight: set.weight ?? null,
      unit: set.weight === undefined ? "" : "lb",
      reps: set.reps,
      warm_up: set.warmUp ? 1 : 0,
      start_ts: setStart,
      peak_ts: peak,
      peak_hr: Math.round(heartRate((peak - start) / 1000)),
    };
  });
}

/** A walk to work on weekdays, a lunch walk most days, and a long one on Sundays. */
function walks(
  date: Temporal.PlainDate,
  at: (hour: number) => number,
  noise: () => number,
): { start_ts: number; end_ts: number; [column: string]: number }[] {
  const spans: [number, number][] = [];
  if (date.dayOfWeek <= 5) {
    spans.push([8.5, 18 + Math.round(4 * noise())]);
  }
  if (noise() > -0.3) {
    spans.push([12.75, 15 + Math.round(8 * noise())]);
  }
  if (date.dayOfWeek === 7) {
    spans.push([10.5, 70 + Math.round(20 * noise())]);
  }
  return spans.map(([from, minutes]) => {
    const start = at(from);
    const cadence = Math.round(108 + 8 * noise());
    return {
      start_ts: start,
      end_ts: start + minutes * 60_000,
      duration_min: minutes,
      steps: Math.round(minutes * cadence * 0.93),
      cadence_spm: cadence,
      brisk_min: Math.round(minutes * (0.6 + 0.3 * noise())),
      avg_hr: Math.round(98 + 6 * noise()),
    };
  });
}

/** Samples every 5 seconds from 5 minutes before `start` to 5 minutes after `end`. */
function samples(start: number, end: number, heartRate: (s: number) => number): Sample[] {
  const out: Sample[] = [];
  for (let ts = start - MARGIN_MS; ts < end + MARGIN_MS; ts += HR_STEP_MS) {
    const second = (ts - start) / 1000;
    const bpm = ts < start || ts >= end ? 82 + wobble(second) : heartRate(second);
    out.push({ ts, values: [Math.round(bpm)] });
  }
  return out;
}

function strainFor(plan: Plan): number {
  const perHour: Record<string, number> = { running: 11, volleyball: 8, lifting: 7, workout: 6 };
  return Math.min(18, (perHour[plan.kind] ?? 6) * Math.sqrt(plan.minutes / 60));
}

/** Roughly what Keytel's equation gives a 75 kg man at this heart rate. */
function kcalFor(minutes: number, avgHr: number): number {
  return Math.round(minutes * Math.max(2, (avgHr - 70) * 0.13));
}

/** From `from` to `to` over `seconds`, then `to`. */
function ramp(second: number, from: number, to: number, seconds: number): number {
  return from + (to - from) * Math.min(1, Math.max(0, second / seconds));
}

/** A few beats of beat-to-beat wobble, the same every run. */
function wobble(second: number): number {
  return 2 * Math.sin(second / 7) + 1.5 * Math.sin(second / 23 + 1);
}

/** A repeatable source of numbers from -0.5 to 0.5. */
function seeded(seed: number): () => number {
  let state = seed;
  return () => {
    state = (state * 9301 + 49297) % 233280;
    return state / 233280 - 0.5;
  };
}

/** "18:30" as 18.5. */
function hours(time: string): number {
  const [h = 0, m = 0] = time.split(":").map(Number);
  return h + m / 60;
}

function round1(value: number): number {
  return Math.round(value * 10) / 10;
}
