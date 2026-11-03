// What the daily note shows: frontmatter numbers (for Dataview, charts and the API) and a short
// Health block for reading. Units are in the frontmatter key names, so values are plain numbers.

import type { Recovery } from "./metrics/recovery";
import type { DayMetrics, NightMetrics } from "./metrics/summary";

export interface DaySummary {
  night: NightMetrics | null;
  day: DayMetrics;
  recovery: Recovery | null;
  /** Nights of history so far, for "calibrating" until there are enough. */
  baselineNights: number;
  tempDevC: number | null;
}

type Fields = Record<string, number | null | undefined>;

/** Frontmatter keys from the health data contract. Missing values are left out. */
export function frontmatter(s: DaySummary): Record<string, number> {
  const fields: Fields = {
    recovery_pct: round(s.recovery?.pct, 0),
    strain: round(s.day.strain, 1),
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

/** The Health block for the daily note. `clock` formats an epoch-ms time as local HH:MM. */
export function healthBlock(s: DaySummary, needed: number, clock: (ts: number) => string): string {
  const lines = [
    recoveryLine(s, needed),
    s.night ? sleepLine(s.night, clock) : null,
    s.night ? vitalsLine(s.night, s.tempDevC) : null,
    strainLine(s.day),
    s.day.steps > 0 ? `- Steps ${s.day.steps.toLocaleString("en-US")}` : null,
  ];
  return ["## Health", "", ...lines.filter((l): l is string => l !== null)].join("\n");
}

function recoveryLine(s: DaySummary, needed: number): string {
  if (s.recovery) {
    return `- Recovery **${Math.round(s.recovery.pct)}%**`;
  }
  return `- Recovery calibrating, ${Math.min(s.baselineNights, needed)}/${needed} nights`;
}

function sleepLine(night: NightMetrics, clock: (ts: number) => string): string {
  const efficiency = Math.round(night.efficiency * 100);
  return `- Sleep ${duration(night.asleepMin)} · ${clock(night.onset)}–${clock(night.wake)} · ${efficiency}%`;
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
