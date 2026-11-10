// VO2max from max and resting heart rate: a slow-moving fitness number. Unlike the rest of the
// metrics it compares you with other people, since that is what VO2max is. See
// docs/health-metrics.md.

import { median } from "./stats";
import type { Sex } from "./strain";

/**
 * Uth 2004 (Eur J Appl Physiol 91:111): VO2max ≈ factor × max HR ÷ resting HR, in ml/kg/min.
 * 15.3 was fitted on 10 well-trained men aged 21–51 and predicted 36 more with an SEE of 2.7
 * ml/kg/min (about 4.5%). Uth 2005 (Int J Sports Med 26:763) found 14.5 for 27 trained women.
 * Outside trained men the error is far wider: an SEE of about 7 ml/kg/min in 109 men of mixed
 * fitness (Esco 2012), and about 2 ml/kg/min too high in untrained men (Castagna 2022).
 */
const FACTOR: Record<Sex, number> = { male: 15.3, female: 14.5 };

/** Resting HR is the median of this many nights, so the number moves as fitness does. */
export const RESTING_NIGHTS = 30;
/** Our own cut-off, as recovery's baseline: under two weeks, a few rough nights move it. */
export const MIN_RESTING_NIGHTS = 14;

export interface Vo2maxInput {
  /**
   * Only a max HR you have seen. With Tanaka's age-predicted max the number would be just age and
   * resting HR again, and Uth's error with a predicted max nearly doubles (4.7 ml/kg/min).
   */
  maxHrMeasured: number | null;
  sex: Sex | null;
  /** One per calendar night, oldest first and ending with last night; null for no reading. */
  restingHrs: (number | null)[];
}

/** VO2max in ml/kg/min, or null without a measured max, sex, or 14 of the last 30 nights. */
export function vo2max(input: Vo2maxInput): number | null {
  const nights = input.restingHrs
    .slice(-RESTING_NIGHTS)
    .filter((bpm): bpm is number => bpm !== null);
  const restingHr = nights.length >= MIN_RESTING_NIGHTS ? median(nights) : null;
  const { maxHrMeasured: maxHr, sex } = input;
  if (maxHr === null || sex === null || restingHr === null || maxHr <= restingHr) {
    return null;
  }
  return (FACTOR[sex] * maxHr) / restingHr;
}
