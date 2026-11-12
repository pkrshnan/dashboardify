// Reads a year of computed health rows for the home screen's trends, and turns them into one
// series per metric. Rows are cached by file modification time, so a reload only reads the days
// the metrics job has rewritten since.

import { stat } from "node:fs/promises";
import type { DailyTable, DerivedRow, DerivedStore, Table } from "../health/derived-store";
import { type MetricDef, trend } from "./trends";
import type { MetricTrend } from "./types";

/** A year for the 1Y chart, plus the 6 days before it that its first weekly mean needs. */
export const HISTORY_DAYS = 371;

export interface MetricSource extends MetricDef {
  table: DailyTable;
  read: (row: DerivedRow) => number | null;
}

const column =
  (name: string) =>
  (row: DerivedRow): number | null =>
    typeof row[name] === "number" ? (row[name] as number) : null;

/** Zone 2 and up: minutes at 60% of max heart rate or more. */
function zone2Plus(row: DerivedRow): number | null {
  const zones = ["zone2_min", "zone3_min", "zone4_min", "zone5_min"].map((k) => column(k)(row));
  return zones.every((z) => z === null) ? null : zones.reduce<number>((s, z) => s + (z ?? 0), 0);
}

/** The home screen's fifteen, in the design's order: heart, sleep, activity, vitals. */
export const METRICS: MetricSource[] = [
  metric("recovery", "Recovery", "%", "heart", "days", column("recovery_pct"), { better: "up" }),
  metric("hrv", "HRV", "ms", "heart", "nights", column("rmssd_ms"), { better: "up" }),
  metric("restingHr", "Resting HR", "bpm", "heart", "nights", column("rhr_bpm"), {
    better: "down",
  }),
  // No unit: "ml/kg/min" crowds the phone row, and the number is read on its own scale anyway.
  metric("vo2max", "VO2max", "", "heart", "days", column("vo2max"), {
    better: "up",
    format: "dec1",
  }),
  metric("sleepScore", "Sleep score", "", "sleep", "nights", column("sleep_score"), {
    better: "up",
  }),
  metric("asleep", "Time asleep", "", "sleep", "nights", column("tst_min"), {
    better: "up",
    format: "duration",
  }),
  metric("deep", "Deep sleep", "", "sleep", "nights", column("deep_min"), {
    better: "up",
    format: "duration",
  }),
  metric("rem", "REM sleep", "", "sleep", "nights", column("rem_min"), {
    better: "up",
    format: "duration",
  }),
  metric("strain", "Strain", "", "activity", "days", column("strain"), {
    format: "dec1",
    cumulative: true,
  }),
  metric("steps", "Steps", "", "activity", "days", column("steps"), {
    better: "up",
    format: "thousands",
    cumulative: true,
  }),
  metric("zone2", "Zone 2+", "min", "activity", "days", zone2Plus, {
    better: "up",
    cumulative: true,
  }),
  // Burning more isn't better or worse in itself, so grey like strain.
  metric("calories", "Calories", "kcal", "activity", "days", column("kcal"), {
    format: "thousands",
    cumulative: true,
  }),
  // Both ways can be wrong: under 0.8 is easing off, over 1.5 a spike. So always grey.
  metric("loadRatio", "Training load", "", "activity", "days", column("load_ratio"), {
    format: "dec1",
  }),
  metric("breathing", "Breathing rate", "/min", "vitals", "nights", column("resp_rate_bpm"), {
    format: "dec1",
  }),
  metric("skinTemp", "Skin temperature", "°C", "vitals", "nights", column("skin_temp_c"), {
    format: "dec1",
    absoluteDelta: true,
  }),
];

function metric(
  key: string,
  name: string,
  unit: string,
  group: MetricDef["group"],
  table: DailyTable,
  read: MetricSource["read"],
  options: Partial<MetricDef>,
): MetricSource {
  return { key, name, unit, group, table, read, format: "int", ...options };
}

export class HealthHistory {
  private readonly cache = new Map<string, { mtimeMs: number; row: DerivedRow | null }>();

  constructor(private readonly store: DerivedStore) {}

  /** Each metric's trend for the HISTORY_DAYS ending on `today`; the home screen's by default. */
  async trends(today: string, metrics: MetricSource[] = METRICS): Promise<MetricTrend[]> {
    const dates = lastDays(today, HISTORY_DAYS);
    const rows = {
      nights: await this.rows("nights", dates),
      days: await this.rows("days", dates),
    };
    return metrics.map((m) =>
      trend(
        m,
        rows[m.table].map((row) => (row ? m.read(row) : null)),
        today,
      ),
    );
  }

  private rows(table: Table, dates: string[]): Promise<(DerivedRow | null)[]> {
    return Promise.all(dates.map((date) => this.row(table, date)));
  }

  private async row(table: Table, date: string): Promise<DerivedRow | null> {
    const path = this.store.path(table, date);
    const mtimeMs = await modified(path);
    if (mtimeMs === null) {
      return null;
    }
    const hit = this.cache.get(path);
    if (hit && hit.mtimeMs === mtimeMs) {
      return hit.row;
    }
    const row = await this.store.read(table, date);
    this.cache.set(path, { mtimeMs, row });
    return row;
  }
}

async function modified(path: string): Promise<number | null> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return null;
  }
}

/** `count` dates ending on `today`, oldest first. */
export function lastDays(today: string, count: number): string[] {
  const end = Temporal.PlainDate.from(today);
  return Array.from({ length: count }, (_, i) => end.subtract({ days: count - 1 - i }).toString());
}
