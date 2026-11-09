// The raw strap samples the metric calculations work on, one type per healthstrap stream.
// Every `ts` is UTC epoch milliseconds.

export interface HeartRate {
  ts: number;
  bpm: number;
}

/** One beat-to-beat gap. `ts` is the beat that ends the gap. */
export interface RrInterval {
  ts: number;
  ms: number;
}

/** The gravity vector in g, once a second. */
export interface Accel {
  ts: number;
  x: number;
  y: number;
  z: number;
}

export interface SkinTemp {
  ts: number;
  celsius: number;
}

/** The strap's raw step counter: cumulative, 16-bit, so it wraps and can reset. */
export interface StepCounter {
  ts: number;
  count: number;
}

/**
 * The strap's motion intensity, unscaled, about once a second. healthstrap inferred its meaning:
 * about 0.006 asleep and 0.03 awake.
 */
export interface Motion {
  ts: number;
  intensity: number;
}

/** A span of time, [start, end) in epoch ms. */
export interface Span {
  start: number;
  end: number;
}

export const MINUTE_MS = 60_000;
