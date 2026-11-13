// Sleep score, 0–100: did you get the sleep you needed, how much of the night you were actually
// asleep, and how regular your timing is. Sufficiency counts most, as in Whoop's "sleep
// performance". All three use your own nights only. See docs/health-metrics.md.

import { mean } from "./stats";

/** Adults need 7–9 hours (AASM); 8 is the middle. Profile.md can override it (sleep_need_h). */
export const DEFAULT_NEED_MIN = 8 * 60;
/** A third of the last three nights' shortfall is added back, up to an hour. */
const DEBT_NIGHTS = 3;
const DEBT_SHARE = 1 / 3;
const MAX_DEBT_MIN = 60;
/** Efficiency maps 65% → 0 and 95% → 100: below 65% is a very broken night, 95%+ is ideal. */
const EFFICIENCY_FLOOR = 0.65;
const EFFICIENCY_TOP = 0.95;
/** Timing 90 minutes off your usual bed and wake times scores 0. */
const TIMING_ZERO_MIN = 90;
const TIMING_NIGHTS = 7;
const MIN_TIMING_NIGHTS = 3;
const WEIGHTS = { sufficiency: 0.6, efficiency: 0.2, consistency: 0.2 };

/** Bed and wake times as minutes after noon, so 23:30 is 690 and 00:30 is 750 (no wrap at midnight). */
export interface SleepTiming {
  onsetMin: number;
  wakeMin: number;
}

export interface PastNight extends SleepTiming {
  asleepMin: number;
}

export interface SleepScore {
  score: number;
  needMin: number;
  sufficiency: number;
  efficiencyScore: number;
  consistency: number | null;
}

/** Tonight's need: your base need plus some of the debt from the last three nights. */
export function sleepNeed(baseMin: number, past: PastNight[]): number {
  const shortfall = past
    .slice(-DEBT_NIGHTS)
    .reduce((sum, n) => sum + Math.max(0, baseMin - n.asleepMin), 0);
  return baseMin + Math.min(MAX_DEBT_MIN, shortfall * DEBT_SHARE);
}

/** 100 when bed and wake times match the last week's average, 0 at 90 minutes off. */
export function consistency(tonight: SleepTiming, past: SleepTiming[]): number | null {
  const recent = past.slice(-TIMING_NIGHTS);
  const usualOnset = mean(recent.map((n) => n.onsetMin));
  const usualWake = mean(recent.map((n) => n.wakeMin));
  if (recent.length < MIN_TIMING_NIGHTS || usualOnset === null || usualWake === null) {
    return null;
  }
  const off = (Math.abs(tonight.onsetMin - usualOnset) + Math.abs(tonight.wakeMin - usualWake)) / 2;
  return 100 * clamp(1 - off / TIMING_ZERO_MIN);
}

export function sleepScore(
  tonight: SleepTiming & { asleepMin: number; efficiency: number },
  past: PastNight[],
  baseNeedMin = DEFAULT_NEED_MIN,
): SleepScore {
  const needMin = sleepNeed(baseNeedMin, past);
  const sufficiency = 100 * clamp(tonight.asleepMin / needMin);
  const efficiencyScore =
    100 * clamp((tonight.efficiency - EFFICIENCY_FLOOR) / (EFFICIENCY_TOP - EFFICIENCY_FLOOR));
  const timing = consistency(tonight, past);
  // Without a few nights of history, consistency's share goes to the other two.
  const parts: [number, number][] = [
    [WEIGHTS.sufficiency, sufficiency],
    [WEIGHTS.efficiency, efficiencyScore],
    ...(timing === null ? [] : ([[WEIGHTS.consistency, timing]] as [number, number][])),
  ];
  const weight = parts.reduce((sum, [w]) => sum + w, 0);
  const score = parts.reduce((sum, [w, v]) => sum + w * v, 0) / weight;
  return { score, needMin, sufficiency, efficiencyScore, consistency: timing };
}

function clamp(value: number): number {
  return Math.min(1, Math.max(0, value));
}
