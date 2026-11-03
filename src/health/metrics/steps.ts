// Steps from the strap's raw counter. It is cumulative and 16-bit, so it wraps at 65,536, and it
// can reset to zero when the strap restarts. Meaning inferred by healthstrap, not documented.

import type { StepCounter } from "./types";

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

function stepDelta(prev: StepCounter, cur: StepCounter): number {
  let delta = cur.count - prev.count;
  if (delta < 0) {
    delta = prev.count >= WRAP_ZONE ? delta + COUNTER_SIZE : cur.count;
  }
  const seconds = Math.max(1, (cur.ts - prev.ts) / 1000);
  return delta <= seconds * MAX_STEPS_PER_SECOND ? delta : 0;
}
