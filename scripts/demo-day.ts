// Today's and yesterday's strap streams for the demo's Day section on the Health page: heart rate,
// the step counter and skin temperature once a second, shaped by the demo's own nights, walks and
// workouts, plus a shower with the strap off. demo-activity.ts gives workouts heart rate every 5
// seconds, too sparse for a minute to count, so those seconds are filled from its samples.

import type { DerivedStore } from "../src/health/derived-store";
import type { RawStore } from "../src/health/raw-store";
import type { Sample } from "../src/health/samples";

interface Options {
  derived: DerivedStore;
  raw: RawStore;
  timeZone: string;
  today: Temporal.PlainDate;
  now: number;
}

type Span = { start: number; end: number };

const SECOND = 1000;
const MARGIN_MS = 5 * 60_000;

export async function writeDemoDays(opts: Options): Promise<void> {
  for (const back of [1, 0]) {
    await writeDay(opts, opts.today.subtract({ days: back }));
  }
}

async function writeDay(opts: Options, date: Temporal.PlainDate) {
  const start = date.toZonedDateTime(opts.timeZone).epochMilliseconds;
  const end = Math.min(
    opts.now,
    date.add({ days: 1 }).toZonedDateTime(opts.timeZone).epochMilliseconds,
  );
  const day = date.toString();
  const night = await opts.derived.read("nights", day);
  const asleep = { start, end: Number(night?.wake_ts ?? start + 7 * 3_600_000) };
  const walks = (await opts.derived.readAll("walks", day)).map(spanOf);
  const workouts = (await opts.derived.readAll("workouts", day)).map(spanOf);
  // A shower half an hour after waking, before the morning gym: the strap is off and sends nothing.
  const shower = { start: asleep.end + 30 * 60_000, end: asleep.end + 50 * 60_000 };
  const workoutHr = await opts.raw.readRange("heart_rate", start, end);
  const signals = { asleep, walks, workouts };
  const rows = { hr: [] as Sample[], steps: [] as Sample[], temp: [] as Sample[] };
  let count = 0;
  for (let ts = start; ts < end; ts += SECOND) {
    if (inside(ts, [shower])) {
      continue;
    }
    count += stepsAt(ts, signals);
    rows.steps.push({ ts, values: [count % 65_536] });
    rows.temp.push({ ts, values: [round(skinTemp(ts, signals), 2)] });
    const bpm = inside(ts, workouts.map(widened))
      ? nearest(workoutHr, ts)
      : Math.round(heartRate(ts, signals));
    rows.hr.push({ ts, values: [bpm] });
  }
  await storeByUtcDay(opts.raw, "heart_rate", "bpm", rows.hr);
  await storeByUtcDay(opts.raw, "steps", "count", rows.steps);
  await storeByUtcDay(opts.raw, "temperature", "celsius", rows.temp);
  await storeByUtcDay(opts.raw, "wear", "on", [
    { ts: shower.start, values: [0] },
    { ts: shower.end, values: [1] },
  ]);
}

interface Signals {
  asleep: Span;
  walks: Span[];
  workouts: Span[];
}

/** Slow drift and some noise on a resting level that depends on what you're doing. */
function heartRate(ts: number, s: Signals): number {
  const drift = 4 * Math.sin(ts / 1_700_000) + 3 * (hash(Math.floor(ts / 240_000)) - 0.5);
  const jitter = 6 * (hash(Math.floor(ts / 10_000)) - 0.5);
  if (inside(ts, [s.asleep])) {
    return 54 + drift + jitter;
  }
  if (inside(ts, s.walks)) {
    return 102 + drift + jitter;
  }
  return 74 + 2 * drift + jitter;
}

/** About 110 a minute on a walk; awake, a quarter of minutes have a short burst; none asleep. */
function stepsAt(ts: number, s: Signals): number {
  if (inside(ts, s.walks)) {
    return ts % 6_000 < 1_000 ? 2 : 1 + (ts % 10_000 < 8_000 ? 1 : 0);
  }
  if (inside(ts, [s.asleep])) {
    return 0;
  }
  const minute = Math.floor(ts / 60_000);
  const burst = hash(minute) < 0.25 ? Math.floor(hash(minute + 0.5) * 50) : 0;
  return ts % 60_000 < burst * 1_000 ? 1 : 0;
}

/** A repeatable 0..1 from a number, so the demo draws the same day each run. */
function hash(n: number): number {
  const x = Math.sin(n * 12.9898) * 43_758.5453;
  return x - Math.floor(x);
}

/** The workout heart rate demo-activity.ts wrote nearest to `ts`. */
function nearest(samples: { ts: number; bpm?: unknown }[], ts: number): number {
  let best: { ts: number; bpm?: unknown } | undefined;
  for (const sample of samples) {
    if (!best || Math.abs(sample.ts - ts) < Math.abs(best.ts - ts)) {
      best = sample;
    }
  }
  return Number(best?.bpm ?? 0);
}

/** Warm in bed, cooler and more changeable up and about, cooler still outdoors on a walk. */
function skinTemp(ts: number, s: Signals): number {
  const drift = 0.3 * Math.sin(ts / 2_400_000);
  if (inside(ts, [s.asleep])) {
    return 35.2 + drift;
  }
  return (inside(ts, s.walks) ? 32.4 : 33.6) + drift + 0.2 * Math.sin(ts / 600_000);
}

async function storeByUtcDay(raw: RawStore, stream: string, column: string, samples: Sample[]) {
  const byDay = new Map<string, Sample[]>();
  for (const sample of samples) {
    const day = new Date(sample.ts).toISOString().slice(0, 10);
    const rows = byDay.get(day);
    if (rows) {
      rows.push(sample);
    } else {
      byDay.set(day, [sample]);
    }
  }
  for (const [day, rows] of byDay) {
    await raw.store(stream, day, { header: ["ts", column], samples: rows });
  }
}

function spanOf(row: Record<string, unknown>): Span {
  return { start: Number(row.start_ts), end: Number(row.end_ts) };
}

/** demo-activity.ts writes a workout's heart rate from 5 minutes before to 5 after. */
function widened(span: Span): Span {
  return { start: span.start - MARGIN_MS, end: span.end + MARGIN_MS };
}

function inside(ts: number, spans: Span[]): boolean {
  return spans.some((s) => ts >= s.start && ts < s.end);
}

function round(value: number, digits: number): number {
  return Math.round(value * 10 ** digits) / 10 ** digits;
}
