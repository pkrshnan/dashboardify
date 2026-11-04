// What the daily note shows: frontmatter numbers (for Dataview, charts and the API) and a short
// Health block for reading. Units are in the frontmatter key names, so values are plain numbers.

import type { Recovery } from "./metrics/recovery";
import type { DayMetrics, NightMetrics } from "./metrics/summary";
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
}

type Fields = Record<string, number | null | undefined>;

/** Frontmatter keys from the health data contract. Missing values are left out. */
export function frontmatter(s: DaySummary): Record<string, number> {
  const fields: Fields = {
    recovery_pct: round(s.recovery?.pct, 0),
    strain: round(s.day.strain, 1),
    sleep_score: round(s.night?.sleep.score, 0),
    sleep_performance_pct: round(s.night?.sleep.sufficiency, 0),
    tst_min: round(s.night?.asleepMin, 0),
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
        s.night ? sleepLine(s.night, clock) : null,
        s.night ? vitalsLine(s.night, s.tempDevC) : null,
        strainLine(s.day),
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

function sleepLine(night: NightMetrics, clock: (ts: number) => string): string {
  const score = Math.round(night.sleep.score);
  const slept = `${duration(night.asleepMin)} of ${duration(night.sleep.needMin)}`;
  return `- Sleep **${score}** · ${slept} · ${clock(night.onset)}–${clock(night.wake)}`;
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

function duration(minutes: number): string {
  const total = Math.round(minutes);
  return `${Math.floor(total / 60)}h ${String(total % 60).padStart(2, "0")}m`;
}

function signed(value: number): string {
  const text = value.toFixed(1);
  return value >= 0 ? `+${text}` : text;
}
