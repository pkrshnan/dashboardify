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

/** Gaussian white noise by Box–Muller from the seeded generator. */
export function whiteNoise(length: number, seed: number): number[] {
  const rand = random(seed);
  return Array.from({ length }, () => {
    const u = Math.max(rand(), 1e-12);
    return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rand());
  });
}

/** 1/f noise by spectral synthesis: a cosine per frequency k, amplitude 1/√k, random phase. */
export function pinkNoise(length: number, seed: number): number[] {
  const rand = random(seed);
  const series = new Array<number>(length).fill(0);
  for (let k = 1; k <= length / 2; k++) {
    const amplitude = 1 / Math.sqrt(k);
    const phase = 2 * Math.PI * rand();
    for (let t = 0; t < length; t++) {
      series[t] = (series[t] ?? 0) + amplitude * Math.cos((2 * Math.PI * k * t) / length + phase);
    }
  }
  return series;
}

/** Beats with each gap `base` + `scale` × the next value of `series`, stamped at the beat. */
export function seriesBeats(
  start: number,
  series: number[],
  base = 1000,
  scale = 40,
): RrInterval[] {
  let t = start;
  return series.map((v) => {
    const ms = Math.round(base + scale * v);
    t += ms;
    return { ts: t, ms };
  });
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
