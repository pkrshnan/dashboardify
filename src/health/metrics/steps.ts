// Steps from the strap's raw counter. It is cumulative and 16-bit, so it wraps at 65,536, and it
// can reset to zero when the strap restarts. Meaning inferred by healthstrap, not documented.

import { MINUTE_MS, type StepCounter } from "./types";

const COUNTER_SIZE = 65_536;
/** A wrap only happens near the top; a drop from lower down is a reset. */
const WRAP_ZONE = 60_000;
/** Nobody takes more than 5 steps a second; bigger jumps are glitches. */
const MAX_STEPS_PER_SECOND = 5;

/** Steps taken across the samples (sorted by ts). */
export function stepsTaken(samples: StepCounter[]): number {
  let total = 0;
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    if (prev && cur) {
      total += stepDelta(prev, cur);
    }
  }
  return total;
}

/** Steps taken in each minute, keyed by the minute's start. Minutes with no steps are left out. */
export function stepsPerMinute(samples: StepCounter[]): Map<number, number> {
  const minutes = new Map<number, number>();
  for (let i = 1; i < samples.length; i++) {
    const prev = samples[i - 1];
    const cur = samples[i];
    const delta = prev && cur ? stepDelta(prev, cur) : 0;
    if (cur && delta > 0) {
      const minute = Math.floor(cur.ts / MINUTE_MS) * MINUTE_MS;
      minutes.set(minute, (minutes.get(minute) ?? 0) + delta);
    }
  }
  return minutes;
}

function stepDelta(prev: StepCounter, cur: StepCounter): number {
  let delta = cur.count - prev.count;
  if (delta < 0) {
    delta = prev.count >= WRAP_ZONE ? delta + COUNTER_SIZE : cur.count;
  }
  const seconds = Math.max(1, (cur.ts - prev.ts) / 1000);
  return delta <= seconds * MAX_STEPS_PER_SECOND ? delta : 0;
}
