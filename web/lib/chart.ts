// Geometry for the health trend charts (docs/design/README.md, "Charts"):
// - a fixed y-range of baseline ± 3 SD, so a small drift looks small;
// - a shaded band for the normal range, baseline ± 1 SD;
// - the line is the 7-day rolling mean, and each day is a faint dot;
// - 1Y shows weekly means, without dots;
// - the latest day is a solid dot at the right edge, so every chart ends at today's value.
// The chart is drawn in a 600 × 100 box that the SVG stretches to fit.

import type { MetricTrend } from "../../src/home/types";
import { addDays, dayMonth } from "./format";

export type Range = "2w" | "1m" | "3m" | "1y";

export const RANGE_DAYS: Record<Range, number> = { "2w": 14, "1m": 30, "3m": 90, "1y": 364 };

export const WIDTH = 600;
const TOP = 4;
const BOTTOM = 96;
const ROLLING = 7;

export interface ChartShape {
  band: { y: number; height: number } | null;
  /** SVG path of zero-length segments, one per day, drawn with round caps as dots. */
  dots: string;
  /** SVG path of the rolling-mean line, broken where there is no data. */
  line: string;
  /** SVG path of the latest day's dot, or "" when it has no data. */
  latest: string;
}

export function chartShape(metric: MetricTrend, range: Range): ChartShape {
  const days = RANGE_DAYS[range];
  const points = linePoints(metric, range, days);
  const shown = range === "1y" ? [] : metric.values.slice(-days);
  const last = metric.values.at(-1) ?? null;
  const scale = yScale(metric, [...points, ...shown, last]);
  const band = metric.baseline
    ? {
        y: scale(metric.baseline.mean + metric.baseline.sd),
        height:
          scale(metric.baseline.mean - metric.baseline.sd) -
          scale(metric.baseline.mean + metric.baseline.sd),
      }
    : null;
  return {
    band,
    dots: shown
      .map((v, i) => (v === null ? "" : `M${x(i, shown.length)},${round(scale(v))}h0`))
      .join(""),
    line: linePath(points, scale),
    latest: last === null ? "" : `M${WIDTH},${round(scale(last))}h0`,
  };
}

/** Today's running total would drag a mean down, so for those metrics the line leaves it out. */
function linePoints(metric: MetricTrend, range: Range, days: number): (number | null)[] {
  const completed = metric.partial ? metric.values.slice(0, -1) : metric.values;
  if (range === "1y") {
    return weeklyMeans(metric.partial ? [...completed, null] : completed, days);
  }
  return metric.partial
    ? [...rollingMeans(completed, days - 1), null]
    : rollingMeans(completed, days);
}

/** The 7-day rolling mean for each of the last `days` days; null where the week is empty. */
export function rollingMeans(values: (number | null)[], days: number): (number | null)[] {
  const start = values.length - days;
  return Array.from({ length: days }, (_, i) =>
    mean(values.slice(Math.max(0, start + i - ROLLING + 1), start + i + 1)),
  );
}

/** Means of consecutive 7-day weeks covering the last `days` days. */
export function weeklyMeans(values: (number | null)[], days: number): (number | null)[] {
  const start = values.length - days;
  return Array.from({ length: Math.ceil(days / ROLLING) }, (_, w) =>
    mean(values.slice(Math.max(0, start + w * ROLLING), start + (w + 1) * ROLLING)),
  );
}

/** Value to y: baseline ± 3 SD when there is a baseline, else the data's own range. */
function yScale(metric: MetricTrend, values: (number | null)[]): (v: number) => number {
  const present = values.filter((v): v is number => v !== null);
  let lo = Math.min(...present);
  let hi = Math.max(...present);
  if (metric.baseline && metric.baseline.sd > 0) {
    lo = metric.baseline.mean - 3 * metric.baseline.sd;
    hi = metric.baseline.mean + 3 * metric.baseline.sd;
  }
  if (!(Number.isFinite(lo) && Number.isFinite(hi)) || hi - lo < 1e-9) {
    const mid = Number.isFinite(lo) ? lo : 0;
    lo = mid - 1;
    hi = mid + 1;
  }
  return (v) => BOTTOM - ((Math.min(hi, Math.max(lo, v)) - lo) / (hi - lo)) * (BOTTOM - TOP);
}

function linePath(points: (number | null)[], scale: (v: number) => number): string {
  let path = "";
  let drawing = false;
  points.forEach((v, i) => {
    if (v === null) {
      drawing = false;
      return;
    }
    path += `${drawing ? "L" : "M"}${x(i, points.length)},${round(scale(v))}`;
    drawing = true;
  });
  return path;
}

function x(i: number, n: number): string {
  return n <= 1 ? String(WIDTH / 2) : round((i / (n - 1)) * WIDTH);
}

function round(v: number): string {
  return v.toFixed(1);
}

function mean(values: (number | null)[]): number | null {
  const present = values.filter((v): v is number => v !== null);
  return present.length > 0 ? present.reduce((s, v) => s + v, 0) / present.length : null;
}

/** "5 Oct – 3 Nov", with the first year on 1Y. */
export function rangeLabel(lastDate: string, range: Range): string {
  const first = addDays(lastDate, -(RANGE_DAYS[range] - 1));
  return `${dayMonth(first, range === "1y")} – ${dayMonth(lastDate)}`;
}
