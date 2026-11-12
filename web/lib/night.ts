// The night view's rules: which night the address names, which home rows link to it, the
// hypnogram's lanes and shades, its hour ticks in the server's time zone, and the stage totals
// line. Times are epoch ms.

import type { NightView, SleepStage } from "../api";
import { duration } from "./activity";
import { nowIn } from "./clock";

/** The home rows that link to the night: the sleep group's. */
export const NIGHT_ROWS = new Set(["sleepScore", "asleep", "deep", "rem"]);

/**
 * The night `?night=` names, by the day it ends on; last night when it is missing, malformed or
 * still to come.
 */
export function nightDate(value: string | undefined, today: string): string {
  return value && /^\d{4}-\d{2}-\d{2}$/.test(value) && value <= today ? value : today;
}

/** Top to bottom, as hypnograms are read: lighter sleep higher. */
export const LANES: SleepStage[] = ["awake", "rem", "light", "deep"];

export const LANE_NAMES: Record<SleepStage, string> = {
  awake: "Awake",
  rem: "REM",
  light: "Light",
  deep: "Deep",
};

/** Shades of the sleep colour #7D7AFF: paler towards waking, deeper towards deep sleep. */
export const STAGE_COLORS: Record<SleepStage, string> = {
  awake: "#D9D8FF",
  rem: "#A9A7FF",
  light: "#7D7AFF",
  deep: "#4E4BCF",
};

const HOUR = 3_600_000;

/** "Deep 1h 25m · REM 1h 40m · Light 4h 07m", or null for a night without stages. */
export function stageTotals(night: NightView): string | null {
  const { deepMin, remMin, lightMin } = night;
  if (deepMin === null || remMin === null || lightMin === null) {
    return null;
  }
  return `Deep ${duration(deepMin)} · REM ${duration(remMin)} · Light ${duration(lightMin)}`;
}

/** Whole hours between `start` and `end` in `timeZone`, so a half-hour zone still ticks at :00. */
export function hourTicks(start: number, end: number, timeZone: string): number[] {
  const wholeMinute = start - (start % 60_000);
  const past = nowIn(timeZone, new Date(wholeMinute)).minutes % 60;
  const ticks: number[] = [];
  for (let t = wholeMinute + ((60 - past) % 60) * 60_000; t <= end; t += HOUR) {
    if (t >= start) {
      ticks.push(t);
    }
  }
  return ticks;
}
