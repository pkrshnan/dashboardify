// GetDayTrace: reads a local day's heart rate, steps, skin temperature and wear from health-raw/,
// and its nights, workouts and walks from health-derived/, and shapes them for the Health page's
// Day section (docs/day-trace.md). Nothing is stored.

import { profileMaxHr } from "../../health/metrics/summary";
import type { Span } from "../../health/metrics/types";
import { parseProfile } from "../../health/profile";
import type { Row } from "../../health/raw-store";
import {
  clip,
  heartRateSeries,
  notWorn,
  type Series,
  skinTempSeries,
  stepSeries,
} from "../../health/trace";
import type { ActivityDeps } from "./activity";

/** How far back to look for the wear row that says whether the strap was on at midnight. */
const WEAR_LOOKBACK_MS = 7 * 86_400_000;

export async function dayTrace(deps: ActivityDeps, date: string) {
  const day = dayOf(deps, date);
  const [heartRate, steps, temperature, wear] = await Promise.all([
    deps.raw.readRange("heart_rate", day.start, day.end),
    deps.raw.readRange("steps", day.start, day.end),
    deps.raw.readRange("temperature", day.start, day.end),
    deps.raw.readRange("wear", day.start - WEAR_LOOKBACK_MS, day.end),
  ]);
  const hr = heartRateSeries(numbers(heartRate, "bpm"), day);
  const profile = parseProfile(await deps.vault.readProfile(), date);
  return {
    name: `days/${date}/trace`,
    startTime: iso(day.start),
    endTime: iso(day.end),
    series: [
      { kind: "KIND_HEART_RATE", ...wire(hr), low: dense(hr.low), high: dense(hr.high) },
      { kind: "KIND_STEPS", ...wire(stepSeries(numbers(steps, "count"), day)) },
      {
        kind: "KIND_SKIN_TEMPERATURE",
        ...wire(skinTempSeries(numbers(temperature, "celsius"), day)),
      },
    ],
    spans: await spans(deps, date, day, wear),
    maxHeartRate: profileMaxHr(profile) ?? undefined,
  };
}

/** Local midnight to the next, cut at now; a day still to come is empty. */
function dayOf(deps: ActivityDeps, date: string): Span {
  const midnight = Temporal.PlainDate.from(date).toZonedDateTime(deps.timeZone);
  const start = midnight.epochMilliseconds;
  const end = midnight.add({ days: 1 }).epochMilliseconds;
  return { start, end: Math.max(start, Math.min(end, (deps.now ?? Date.now)())) };
}

async function spans(deps: ActivityDeps, date: string, day: Span, wear: Row[]) {
  const next = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
  const nights = [await deps.derived.read("nights", date), await deps.derived.read("nights", next)];
  const workouts = await deps.derived.readAll("workouts", date);
  const walks = await deps.derived.readAll("walks", date);
  const all = [
    ...nights.flatMap((n) => (n ? [span("KIND_SLEEP", n.bed_ts, n.wake_ts)] : [])),
    ...workouts
      .filter((w) => w.status !== "dismissed")
      .map((w) => ({ ...span("KIND_WORKOUT", w.start_ts, w.end_ts), workoutKind: String(w.kind) })),
    ...walks.map((w) => span("KIND_WALK", w.start_ts, w.end_ts)),
    ...notWorn(
      wear.map((r) => ({ ts: r.ts, on: r.on !== 0 })),
      day,
    ).map((s) => ({ kind: "KIND_NOT_WORN", ...s })),
  ];
  return clip(all, day)
    .sort((a, b) => a.start - b.start)
    .map(({ start, end, ...rest }) => ({ ...rest, startTime: iso(start), endTime: iso(end) }));
}

function span(kind: string, start: unknown, end: unknown) {
  return { kind, start: Number(start), end: Number(end) };
}

/** Rows whose column is a number, as `{ ts, <key>: value }`. */
function numbers<K extends string>(rows: Row[], key: K): ({ ts: number } & Record<K, number>)[] {
  return rows.flatMap((r) => {
    const value = r[key];
    return typeof value === "number"
      ? [{ ts: r.ts, [key]: value } as { ts: number } & Record<K, number>]
      : [];
  });
}

/** A series as the proto sends it: dense values with the missing buckets listed. */
function wire(series: Series) {
  return {
    bucketSeconds: series.bucketMs / 1000,
    values: dense(series.values),
    missingIndexes: series.values.flatMap((v, i) => (v === null ? [i] : [])),
  };
}

function dense(values: (number | null)[]): number[] {
  return values.map((v) => v ?? 0);
}

function iso(ts: number): string {
  return new Date(ts).toISOString();
}
