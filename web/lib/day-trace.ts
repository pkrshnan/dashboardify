// The Day section's rules (docs/day-trace.md): heart-rate zones and their shades, the y scales,
// and the SVG paths the three charts draw. Each chart is one unit per minute wide, so a series
// with 5-minute buckets and one with 1-minute buckets line up. Pure; the component renders.

import type { DayTraceView, TraceSeriesView } from "../api";

/** A day is 1,440 minutes; a 25-hour day (clocks back) gets its extra hour. */
export function dayMinutes(trace: DayTraceView): number {
  const longest = [trace.heartRate, trace.steps, trace.skinTemp].map(
    (s) => s.values.length * s.bucketMin,
  );
  return Math.max(1440, ...longest);
}

/**
 * Below zone 1, then zones 1 to 5, as shades of the heart colour #FF7EB6 (zone 3), lighter as
 * they climb, so they differ in lightness as well as hue (docs/design/README.md).
 */
export const ZONE_COLORS = ["#6E4A5C", "#9C5F7E", "#CC6E9C", "#FF7EB6", "#FFA3CB", "#FFD1E5"];

/** The zone lines: 50, 60, 70, 80 and 90% of max HR, as zoneMinutes counts them. */
export const ZONE_SHARES = [0.5, 0.6, 0.7, 0.8, 0.9];

/** 0 below zone 1, else 1 to 5. */
export function zoneOf(bpm: number, maxHr: number): number {
  const zone = Math.floor((bpm / maxHr) * 10) - 5;
  return zone < 0 ? 0 : Math.min(4, zone) + 1;
}

export type Scale = (value: number) => number;

/** Maps lo..hi onto height..0, so higher values are drawn higher. */
export function scale(lo: number, hi: number, height: number): Scale {
  return (value) => round(height - ((value - lo) / (hi - lo)) * height);
}

/** Heart rate's fixed range: low enough for sleep, high enough for zone 5 at most ages. */
export const HR_RANGE = { lo: 40, hi: 190 };

/** Skin temperature's range: the day's, padded to whole degrees, at least 4 °C tall. */
export function tempRange(values: (number | null)[]): { lo: number; hi: number } {
  const known = values.filter((v): v is number => v !== null);
  if (known.length === 0) {
    return { lo: 31, hi: 37 };
  }
  const lo = Math.floor(Math.min(...known) - 0.5);
  const hi = Math.max(Math.ceil(Math.max(...known) + 0.5), lo + 4);
  return { lo, hi };
}

/** Steps' range: 600 a bucket, more on a day that beats it, rounded up to 300. */
export function stepsMax(values: (number | null)[]): number {
  const most = Math.max(0, ...values.filter((v): v is number => v !== null));
  return Math.max(600, Math.ceil(most / 300) * 300);
}

/** A line through each bucket's middle, broken where a bucket is missing. */
export function linePath(series: TraceSeriesView, y: Scale): string {
  let d = "";
  let open = false;
  for (const [i, v] of series.values.entries()) {
    if (v === null) {
      open = false;
      continue;
    }
    d += `${open ? "L" : "M"}${mid(i, series.bucketMin)} ${y(v)}`;
    open = true;
  }
  return d;
}

/** Heart rate's line, one path per zone, each segment in the zone of its midpoint. */
export function zonePaths(
  series: TraceSeriesView,
  maxHr: number | null,
  y: Scale,
): { d: string; color: string }[] {
  if (maxHr === null) {
    return [{ d: linePath(series, y), color: ZONE_COLORS[3] ?? "" }];
  }
  const paths = ZONE_COLORS.map(() => "");
  const { values, bucketMin } = series;
  for (let i = 0; i + 1 < values.length; i++) {
    const a = values[i];
    const b = values[i + 1];
    if (a == null || b == null) {
      continue;
    }
    const zone = zoneOf((a + b) / 2, maxHr);
    paths[zone] += `M${mid(i, bucketMin)} ${y(a)}L${mid(i + 1, bucketMin)} ${y(b)}`;
  }
  return paths.map((d, zone) => ({ d, color: ZONE_COLORS[zone] ?? "" })).filter((p) => p.d);
}

/** The band from each minute's lowest to highest second, one closed shape per unbroken run. */
export function bandPath(
  low: (number | null)[],
  high: (number | null)[],
  bucketMin: number,
  y: Scale,
): string {
  let d = "";
  let run: number[] = [];
  const flush = () => {
    if (run.length > 1) {
      const top = run.map((i) => `${mid(i, bucketMin)} ${y(high[i] ?? 0)}`);
      const bottom = [...run].reverse().map((i) => `${mid(i, bucketMin)} ${y(low[i] ?? 0)}`);
      d += `M${top.join("L")}L${bottom.join("L")}Z`;
    }
    run = [];
  };
  for (const [i, v] of low.entries()) {
    if (v === null || high[i] == null) {
      flush();
    } else {
      run.push(i);
    }
  }
  flush();
  return d;
}

/** A bar per bucket with steps, with a gap of a fifth of a bucket between bars. */
export function barPath(series: TraceSeriesView, y: Scale, base: number): string {
  const width = round(series.bucketMin * 0.8);
  return series.values
    .map((v, i) =>
      v
        ? `M${round(i * series.bucketMin + series.bucketMin * 0.1)} ${base}h${width}V${y(v)}h-${width}Z`
        : "",
    )
    .join("");
}

/** The last bucket with a value, as its index and value. */
export function latest(series: TraceSeriesView): { index: number; value: number } | null {
  for (let i = series.values.length - 1; i >= 0; i--) {
    const value = series.values[i];
    if (value != null) {
      return { index: i, value };
    }
  }
  return null;
}

/** The lowest and highest value of the day, or null without any. */
export function extent(values: (number | null)[]): { lo: number; hi: number } | null {
  const known = values.filter((v): v is number => v !== null);
  return known.length > 0 ? { lo: Math.min(...known), hi: Math.max(...known) } : null;
}

export function total(values: (number | null)[]): number {
  return values.reduce<number>((sum, v) => sum + (v ?? 0), 0);
}

function mid(index: number, bucketMin: number): number {
  return round(index * bucketMin + bucketMin / 2);
}

function round(value: number): number {
  return Math.round(value * 10) / 10;
}
