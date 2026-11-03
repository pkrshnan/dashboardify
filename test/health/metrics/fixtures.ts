// Synthetic strap data for the metric tests.

import type { Accel, HeartRate, RrInterval } from "../../../src/health/metrics/types";

export const HOUR = 3_600_000;
export const T0 = Date.parse("2026-11-01T18:00:00Z");

/** A seeded pseudo-random generator, so tests are repeatable. */
export function random(seed = 1): () => number {
  let state = seed;
  return () => {
    state = (state * 1_103_515_245 + 12_345) % 2_147_483_648;
    return state / 2_147_483_648;
  };
}

/** Beats with a gap of `base` ms that swings ± `swing` ms once per breath. */
export function breathingBeats(
  start: number,
  durationMs: number,
  { base = 1000, swing = 40, breathsPerMin = 15, noise = 5 } = {},
): RrInterval[] {
  const rand = random(7);
  const beats: RrInterval[] = [];
  let t = start;
  while (t < start + durationMs) {
    const phase = (2 * Math.PI * breathsPerMin * (t - start)) / 60_000;
    const ms = Math.round(base + swing * Math.sin(phase) + (rand() - 0.5) * noise);
    t += ms;
    beats.push({ ts: t, ms });
  }
  return beats;
}

/** Accelerometer at 1 Hz: restless (arm angle jumps around) except during `sleep`. */
export function accelDay(from: number, to: number, sleep: { start: number; end: number }) {
  const rand = random(3);
  const samples: Accel[] = [];
  for (let ts = from; ts < to; ts += 1000) {
    const asleep = ts >= sleep.start && ts < sleep.end;
    const angle = asleep ? 0.3 + rand() * 0.02 : rand() * 60 - 30;
    const rad = (angle * Math.PI) / 180;
    samples.push({ ts, x: Math.cos(rad), y: 0, z: Math.sin(rad) });
  }
  return samples;
}

/** Heart rate at 1 Hz, `bpm(ts)` per second. */
export function heartRate(from: number, to: number, bpm: (ts: number) => number): HeartRate[] {
  const samples: HeartRate[] = [];
  for (let ts = from; ts < to; ts += 1000) {
    samples.push({ ts, bpm: bpm(ts) });
  }
  return samples;
}
