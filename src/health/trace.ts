// A day's trace: heart rate, steps and skin temperature in buckets over the day, and the spans
// (sleep, workouts, walks, time not worn) the page shades behind them. Pure functions; the
// Activity service reads the streams and the computed tables. See docs/day-trace.md.

import { minuteHr } from "./metrics/heart-rate";
import { bucket, mean, round } from "./metrics/stats";
import { stepsPerMinute } from "./metrics/steps";
import {
  type HeartRate,
  MINUTE_MS,
  type SkinTemp,
  type Span,
  type StepCounter,
} from "./metrics/types";

const STEP_BUCKET_MS = 5 * MINUTE_MS;

export interface Series {
  bucketMs: number;
  /** One per bucket from the day's start; null where there were no samples. */
  values: (number | null)[];
}

export interface HeartRateSeries extends Series {
  /** The lowest and highest second in each minute that has a value. */
  low: (number | null)[];
  high: (number | null)[];
}

/** One `wear` row: whether the strap was on from `ts`. */
export interface Wear {
  ts: number;
  on: boolean;
}

/** Minute means as minuteHr counts them (a 0 bpm second is no sample), with each minute's range. */
export function heartRateSeries(samples: HeartRate[], day: Span): HeartRateSeries {
  const worn = samples.filter((s) => s.bpm > 0 && s.ts >= day.start && s.ts < day.end);
  const values = slots(day, MINUTE_MS);
  const low = slots(day, MINUTE_MS);
  const high = slots(day, MINUTE_MS);
  const seconds = bucket(worn, MINUTE_MS);
  for (const minute of minuteHr(worn)) {
    const i = (minute.ts - day.start) / MINUTE_MS;
    const bpms = (seconds.get(minute.ts / MINUTE_MS) ?? []).map((s) => s.bpm);
    values[i] = round(minute.bpm, 1);
    low[i] = Math.min(...bpms);
    high[i] = Math.max(...bpms);
  }
  return { bucketMs: MINUTE_MS, values, low, high };
}

/**
 * Steps in each 5 minutes. A bucket the counter reported in but no steps were taken is 0; one
 * it never reported in is missing, so time off the wrist isn't read as sitting still.
 */
export function stepSeries(samples: StepCounter[], day: Span): Series {
  const values = slots(day, STEP_BUCKET_MS);
  for (const s of samples) {
    const i = indexIn(day, STEP_BUCKET_MS, s.ts);
    if (i !== null) {
      values[i] = 0;
    }
  }
  for (const [minute, steps] of stepsPerMinute(samples)) {
    const i = indexIn(day, STEP_BUCKET_MS, minute);
    if (i !== null) {
      values[i] = (values[i] ?? 0) + steps;
    }
  }
  return { bucketMs: STEP_BUCKET_MS, values };
}

export function skinTempSeries(samples: SkinTemp[], day: Span): Series {
  const values = slots(day, MINUTE_MS);
  const inDay = samples.filter((s) => s.ts >= day.start && s.ts < day.end);
  for (const [key, group] of bucket(inDay, MINUTE_MS)) {
    const i = (key * MINUTE_MS - day.start) / MINUTE_MS;
    values[i] = round(mean(group.map((s) => s.celsius)), 2);
  }
  return { bucketMs: MINUTE_MS, values };
}

/**
 * Stretches the strap said it was off, cut to the day. `wear` is sorted and may start before
 * the day, so the state at midnight is known.
 */
export function notWorn(wear: Wear[], day: Span): Span[] {
  const spans: Span[] = [];
  let offSince: number | null = null;
  for (const row of wear) {
    if (!row.on && offSince === null) {
      offSince = row.ts;
    } else if (row.on && offSince !== null) {
      spans.push({ start: offSince, end: row.ts });
      offSince = null;
    }
  }
  if (offSince !== null) {
    spans.push({ start: offSince, end: day.end });
  }
  return clip(spans, day);
}

/** The parts of the spans inside the day; spans wholly outside it are dropped. */
export function clip<T extends Span>(spans: T[], day: Span): T[] {
  return spans
    .map((s) => ({ ...s, start: Math.max(s.start, day.start), end: Math.min(s.end, day.end) }))
    .filter((s) => s.end > s.start);
}

/** A null for each bucket from the day's start to its end; today's end is now. */
function slots(day: Span, bucketMs: number): (number | null)[] {
  return Array.from(
    { length: Math.max(0, Math.ceil((day.end - day.start) / bucketMs)) },
    () => null,
  );
}

function indexIn(day: Span, bucketMs: number, ts: number): number | null {
  return ts >= day.start && ts < day.end ? Math.floor((ts - day.start) / bucketMs) : null;
}
