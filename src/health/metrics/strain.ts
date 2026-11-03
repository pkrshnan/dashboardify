// Strain: how much load the day put on your cardiovascular system, from heart rate.
// Banister's training impulse (TRIMP, 1991), squashed onto Whoop's 0–21 feel.
// See docs/health-metrics.md.

import type { MinuteHr } from "./heart-rate";

/** Banister's lactate-curve constants: men 0.64 and 1.92, women 0.86 and 1.67. */
const WEIGHTS = {
  male: { a: 0.64, b: 1.92 },
  female: { a: 0.86, b: 1.67 },
} as const;
export type Sex = keyof typeof WEIGHTS;
/** Minutes under 30% of heart-rate reserve (desk work, walking around the house) don't count. */
const MIN_RESERVE = 0.3;
/** Scale of the 0–21 curve: TRIMP 100 gives strain 13.3. */
const STRAIN_SCALE = 100;
const MAX_STRAIN = 21;

/** Fraction of heart-rate reserve: 0 at resting HR, 1 at max HR. */
export function reserve(bpm: number, restingHr: number, maxHr: number): number {
  return (bpm - restingHr) / (maxHr - restingHr);
}

/** One minute's TRIMP: reserve × a·e^(b·reserve), so hard minutes count exponentially more. */
export function minuteTrimp(fraction: number, sex: Sex): number {
  if (fraction < MIN_RESERVE) {
    return 0;
  }
  const { a, b } = WEIGHTS[sex];
  return fraction * a * Math.exp(b * Math.min(fraction, 1));
}

export function trimp(minutes: MinuteHr[], restingHr: number, maxHr: number, sex: Sex): number {
  return minutes.reduce((sum, m) => sum + minuteTrimp(reserve(m.bpm, restingHr, maxHr), sex), 0);
}

/** Strain = 21 × (1 − e^(−TRIMP/100)): each extra point is harder to earn. */
export function strain(totalTrimp: number): number {
  return MAX_STRAIN * (1 - Math.exp(-totalTrimp / STRAIN_SCALE));
}
