// Health trend numbers for the home screen, from a daily series. The rules come from
// docs/design/README.md ("Health numbers"):
// - change = the 7-day mean against a baseline of the 60 days before those 7;
// - it is a percentage, except skin temperature, which is a difference in °C;
// - green or red only when the change is at least half a baseline SD, otherwise grey;
// - cumulative metrics (strain, steps, zone 2+, calories) show today's running total next to yesterday's,
//   but the change leaves today out, so a partial day never counts.

import type { HealthGroup, MetricTrend, Tone } from "./types";

export const WINDOW_DAYS = 7;
export const BASELINE_DAYS = 60;
/** Fewer than this many baseline days, and the change is not shown. */
export const MIN_BASELINE_DAYS = 14;
const MIN_WINDOW_DAYS = 3;
const NOISE_SD = 0.5;

export type Format = "int" | "dec1" | "duration" | "thousands";

export interface MetricDef {
  key: string;
  name: string;
  unit: string;
  group: HealthGroup;
  /** Which way is good for you; undefined means the change is always grey. */
  better?: "up" | "down";
  format: Format;
  cumulative?: boolean;
  /** Show the change as a difference in the unit, not a percentage. */
  absoluteDelta?: boolean;
}

/**
 * The trend for one metric. `values` are daily values, oldest first, the last one being
 * `today`. For a cumulative metric today's value is a running total: it is shown, but the
 * change is computed from the days before it.
 */
export function trend(def: MetricDef, values: (number | null)[], today: string): MetricTrend {
  const completed = def.cumulative ? values.slice(0, -1) : values;
  const current = values.at(-1) ?? null;
  const yesterday = def.cumulative ? (completed.at(-1) ?? null) : null;
  const change = changeOf(completed);
  return {
    key: def.key,
    name: def.name,
    unit: def.unit,
    group: def.group,
    value: current === null ? null : formatValue(current, def.format),
    raw: current,
    delta: change ? formatDelta(change.diff, change.mean, def) : null,
    tone: change ? toneOf(change, def.better) : "neutral",
    partial: Boolean(def.cumulative),
    yesterdayValue: yesterday === null ? null : formatValue(yesterday, def.format),
    baseline: change ? { mean: change.mean, sd: change.sd } : null,
    values,
    lastDate: today,
  };
}

interface Change {
  /** 7-day mean minus baseline mean. */
  diff: number;
  mean: number;
  sd: number;
}

/** The last 7 days against the 60 before them, or null without enough data. */
export function changeOf(series: (number | null)[]): Change | null {
  const window = present(series.slice(-WINDOW_DAYS));
  const base = present(series.slice(-(WINDOW_DAYS + BASELINE_DAYS), -WINDOW_DAYS));
  if (window.length < MIN_WINDOW_DAYS || base.length < MIN_BASELINE_DAYS) {
    return null;
  }
  const mean = average(base);
  const sd = Math.sqrt(average(base.map((v) => (v - mean) ** 2)));
  return { diff: average(window) - mean, mean, sd };
}

export function toneOf(change: Change, better: MetricDef["better"]): Tone {
  if (!better || Math.abs(change.diff) < NOISE_SD * change.sd || change.diff === 0) {
    return "neutral";
  }
  return change.diff > 0 === (better === "up") ? "good" : "bad";
}

const MINUS = "−";

export function formatDelta(diff: number, mean: number, def: MetricDef): string {
  if (def.absoluteDelta) {
    const rounded = Math.round(diff * 10) / 10;
    return `${signed(rounded, rounded.toFixed(1).replace("-", ""))} ${def.unit}`;
  }
  const pct = mean === 0 ? 0 : Math.round((diff / mean) * 100);
  return `${signed(pct, String(Math.abs(pct)))}%`;
}

function signed(value: number, magnitude: string): string {
  if (value === 0) {
    return "0";
  }
  return `${value > 0 ? "+" : MINUS}${magnitude}`;
}

export function formatValue(value: number, format: Format): string {
  switch (format) {
    case "dec1":
      return value.toFixed(1);
    case "duration":
      return duration(value);
    case "thousands":
      return Math.round(value).toLocaleString("en-US");
    default:
      return String(Math.round(value));
  }
}

/** Minutes as "7h 12m". */
export function duration(minutes: number): string {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function present(values: (number | null)[]): number[] {
  return values.filter((v): v is number => v !== null && Number.isFinite(v));
}

function average(values: number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}
