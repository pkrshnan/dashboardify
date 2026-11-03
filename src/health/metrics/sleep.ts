// Finding the night's sleep window from the strap's gravity vector (van Hees et al. 2015/2018,
// the "HDCZA" method in GGIR). Asleep, you change posture only now and then; awake in bed, much
// more. See docs/health-metrics.md.

import { bucket, mean, median, percentile } from "./stats";
import type { Accel, Span } from "./types";

const STEP_MS = 5_000;
/** Rolling median over 5 minutes of 5-second steps. */
const SMOOTH_STEPS = 60;
/** Threshold = 15 × the day's 10th percentile, clamped to 0.13–0.5° as GGIR does. */
const THRESHOLD_FACTOR = 15;
const MIN_THRESHOLD = 0.13;
const MAX_THRESHOLD = 0.5;
/** Still for 30 minutes = sustained inactivity; blocks under an hour apart are joined. */
const MIN_BLOCK_MS = 30 * 60_000;
const MAX_JOIN_GAP_MS = 60 * 60_000;
/** A gap in the data (strap off or out of range) longer than this breaks a still stretch. */
const MAX_DATA_GAP_MS = 2 * 60_000;

export interface AngleChange {
  /** Start of the 5-second step. */
  ts: number;
  /** Absolute change in arm angle from the previous step, in degrees, smoothed. */
  change: number;
}

/** Arm elevation angle in degrees: how far the strap's z axis points up or down. */
export function armAngle(sample: Accel): number {
  return (Math.atan2(sample.z, Math.hypot(sample.x, sample.y)) * 180) / Math.PI;
}

/** Mean angle per 5-second step, then the absolute change between consecutive steps. */
export function rawAngleChanges(samples: Accel[]): AngleChange[] {
  const means = [...bucket(samples, STEP_MS).entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([key, group]) => ({ ts: key * STEP_MS, angle: mean(group.map(armAngle)) ?? 0 }));
  const changes: AngleChange[] = [];
  for (let i = 1; i < means.length; i++) {
    const prev = means[i - 1];
    const cur = means[i];
    if (prev && cur && cur.ts - prev.ts <= MAX_DATA_GAP_MS) {
      changes.push({ ts: cur.ts, change: Math.abs(cur.angle - prev.angle) });
    }
  }
  return changes;
}

/** rawAngleChanges, smoothed with a 5-minute rolling median. */
export function angleChanges(samples: Accel[]): AngleChange[] {
  return smooth(rawAngleChanges(samples));
}

/** Centred rolling median, so one twitch doesn't count as waking up. */
function smooth(changes: AngleChange[]): AngleChange[] {
  const half = SMOOTH_STEPS / 2;
  return changes.map((c, i) => {
    const window = changes.slice(Math.max(0, i - half), i + half).map((w) => w.change);
    return { ts: c.ts, change: median(window) ?? c.change };
  });
}

/** How still counts as still, scaled to this person and night. */
export function stillThreshold(changes: AngleChange[]): number {
  const p10 = percentile(
    changes.map((c) => c.change),
    10,
  );
  return Math.min(MAX_THRESHOLD, Math.max(MIN_THRESHOLD, (p10 ?? 0) * THRESHOLD_FACTOR));
}

/** Runs of consecutive still steps, as spans. Data gaps end a run. */
export function stillSpans(changes: AngleChange[], threshold: number): Span[] {
  const spans: Span[] = [];
  let current: Span | null = null;
  for (const c of changes) {
    const continues = current !== null && c.ts - current.end <= MAX_DATA_GAP_MS;
    if (c.change >= threshold) {
      current = null;
    } else if (current && continues) {
      current.end = c.ts + STEP_MS;
    } else {
      current = { start: c.ts, end: c.ts + STEP_MS };
      spans.push(current);
    }
  }
  return spans;
}

/** Keep blocks of 30+ minutes, join those under an hour apart, and return the longest. */
export function longestBlock(spans: Span[]): Span | null {
  const joined: Span[] = [];
  for (const span of spans.filter((s) => s.end - s.start >= MIN_BLOCK_MS)) {
    const last = joined[joined.length - 1];
    if (last && span.start - last.end < MAX_JOIN_GAP_MS) {
      last.end = span.end;
    } else {
      joined.push({ ...span });
    }
  }
  return joined.reduce<Span | null>(
    (best, s) => (best === null || s.end - s.start > best.end - best.start ? s : best),
    null,
  );
}

/**
 * The main sleep period in a stretch of accelerometer data (e.g. 6 pm to 2 pm next day): from
 * lying still to getting up. Whether you were asleep inside it is scored by sleep-epochs.ts.
 */
export function sleepWindow(samples: Accel[]): Span | null {
  const changes = angleChanges(samples);
  return longestBlock(stillSpans(changes, stillThreshold(changes)));
}
