// Skin temperature during sleep. Asleep, the body dumps heat through the skin, so skin warms;
// fever, alcohol and the menstrual cycle shift it. Only the change from your normal means much.

import { median } from "./stats";
import type { SkinTemp, Span } from "./types";

/** Skin takes a while to warm up after you lie down, so skip the first 30 minutes. */
const SETTLE_MS = 30 * 60_000;

/** Median skin temperature during sleep, after it settles. */
export function sleepSkinTemp(samples: SkinTemp[], sleep: Span): number | null {
  const from = sleep.start + SETTLE_MS;
  return median(samples.filter((s) => s.ts >= from && s.ts < sleep.end).map((s) => s.celsius));
}
