// Resting heart rate, minute-by-minute heart rate, and heart-rate zones.

import { bucket, mean, percentile } from "./stats";
import type { HeartRate, Span } from "./types";
import { MINUTE_MS } from "./types";

/** A minute counts only if the strap reported HR for at least half of it. */
const MIN_SECONDS_PER_MINUTE = 30;
/** Resting HR smooths over 5 minutes, then takes the 10th percentile of those means. */
const RESTING_SMOOTH_MIN = 5;
const RESTING_PERCENTILE = 10;

export interface MinuteHr {
  /** Start of the minute. */
  ts: number;
  bpm: number;
}

/** Mean HR per minute, for minutes with enough samples. Sorted by time. */
export function minuteHr(samples: HeartRate[], span?: Span): MinuteHr[] {
  const inSpan = span ? samples.filter((s) => s.ts >= span.start && s.ts < span.end) : samples;
  return [...bucket(inSpan, MINUTE_MS).entries()]
    .filter(([, group]) => group.length >= MIN_SECONDS_PER_MINUTE)
    .map(([key, group]) => ({ ts: key * MINUTE_MS, bpm: mean(group.map((s) => s.bpm)) ?? 0 }))
    .sort((a, b) => a.ts - b.ts);
}

/**
 * Resting HR during sleep: rolling 5-minute means, then the 10th percentile. That is one of your
 * calmest stretches, without trusting the single lowest value, which is often a glitch.
 */
export function restingHr(minutes: MinuteHr[]): number | null {
  const means: number[] = [];
  for (let i = RESTING_SMOOTH_MIN - 1; i < minutes.length; i++) {
    const window = minutes.slice(i - RESTING_SMOOTH_MIN + 1, i + 1);
    const first = window[0];
    const last = window[window.length - 1];
    // Only full, unbroken 5-minute stretches.
    if (first && last && last.ts - first.ts === (RESTING_SMOOTH_MIN - 1) * MINUTE_MS) {
      means.push(mean(window.map((m) => m.bpm)) ?? 0);
    }
  }
  return percentile(means, RESTING_PERCENTILE);
}

/** Max HR from age (Tanaka 2001): 208 − 0.7 × age. Closer than the old 220 − age. */
export function predictedMaxHr(ageYears: number): number {
  return 208 - 0.7 * ageYears;
}

/** Minutes in each zone, by % of max HR: 50–60, 60–70, 70–80, 80–90, 90+. */
export function zoneMinutes(minutes: MinuteHr[], maxHr: number): number[] {
  const zones = [0, 0, 0, 0, 0];
  for (const m of minutes) {
    const zone = Math.floor((m.bpm / maxHr) * 10) - 5;
    const index = Math.min(4, zone);
    if (zone >= 0) {
      zones[index] = (zones[index] ?? 0) + 1;
    }
  }
  return zones;
}
