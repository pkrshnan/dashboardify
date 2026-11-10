// Fitness age: the age at which a healthy person of your sex has your VO2max. Like VO2max it
// compares you with other people, which is the point. See docs/health-metrics.md.

import type { Sex } from "./strain";

/**
 * Mean VO2max (ml/kg/min) of healthy Norwegians by decade: Loe 2013 (PLoS One 8:e64319, Table 2),
 * the HUNT3 Fitness Study's treadmill tests of 1,929 men and 1,881 women aged 20–90 with no heart
 * or lung disease, cancer or blood pressure drugs. NTNU's fitness age (Nes 2014, Med Sci Sports
 * Exerc 46:1159) comes from the same group and cohort, but its own age curve isn't in any source
 * we could read, so these published means stand in for it. Each mean sits at its decade's
 * midpoint; the 70+ group (70–90) at 75.
 */
const NORMS: Record<Sex, [age: number, vo2max: number][]> = {
  male: [
    [25, 54.4],
    [35, 49.1],
    [45, 47.2],
    [55, 42.6],
    [65, 39.2],
    [75, 35.3],
  ],
  female: [
    [25, 43.0],
    [35, 40.0],
    [45, 38.4],
    [55, 34.4],
    [65, 31.1],
    [75, 28.3],
  ],
};

/** The study's age range: past it the norms say nothing, so a 70 doesn't read as 12. */
const MIN_AGE = 20;
const MAX_AGE = 90;

/**
 * Whole years, read off the norms with straight lines between decades and the end decades'
 * slope past them, then held to 20–90. Null without a VO2max or sex.
 */
export function fitnessAge(vo2max: number | null, sex: Sex | null): number | null {
  if (vo2max === null || sex === null) {
    return null;
  }
  const norms = NORMS[sex];
  // The pair of decades whose means straddle vo2max, or the end pair when it is outside them.
  const firstAtOrBelow = norms.findIndex(([, mean]) => mean <= vo2max);
  const pair = firstAtOrBelow === -1 ? norms.length - 2 : Math.max(firstAtOrBelow - 1, 0);
  const [youngAge, youngMean] = norms[pair] ?? [0, 0];
  const [oldAge, oldMean] = norms[pair + 1] ?? [0, 0];
  const age = youngAge + ((youngMean - vo2max) / (youngMean - oldMean)) * (oldAge - youngAge);
  return Math.round(Math.min(MAX_AGE, Math.max(MIN_AGE, age)));
}
