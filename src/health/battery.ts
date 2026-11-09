// The strap's latest battery report, from the battery stream (pct, charging). The firmware logs a
// state-of-charge report every 10 to 60 minutes while worn, so a few days back always finds one.

import type { Row } from "./raw-store";

export interface StrapBattery {
  /** Epoch ms of the report. */
  ts: number;
  percent: number;
  /** null until the strap reports a charger change. */
  charging: boolean | null;
}

/** How far back to look for a report. */
export const BATTERY_LOOKBACK_MS = 3 * 86_400_000;

/** Below this the home screen shows the battery in orange. */
export const LOW_BATTERY_PCT = 20;

/** The newest row with a percent, or null when there is none. Rows are oldest first. */
export function latestBattery(rows: Row[]): StrapBattery | null {
  for (let i = rows.length - 1; i >= 0; i--) {
    const row = rows[i];
    if (row && typeof row.pct === "number") {
      const charging = typeof row.charging === "number" ? row.charging !== 0 : null;
      return { ts: row.ts, percent: row.pct, charging };
    }
  }
  return null;
}
