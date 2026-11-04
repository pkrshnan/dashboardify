// The tuning report: what the re-fit found, in plain words, with the numbers behind it.

import { type RecoveryWeights, WEIGHT_KEYS } from "../params";
import { type HeldOut, MAX_DAY_SHIFT, MIN_GAIN, type Shift } from "./backtest";
import { MIN_RATED, type Refit } from "./refit";

export interface TuningResult {
  from: string;
  to: string;
  current: RecoveryWeights;
  refit: Refit;
  heldOut: HeldOut;
  moved: Shift;
  worthApplying: boolean;
}

const LABELS: Record<keyof RecoveryWeights, string> = {
  hrv: "HRV",
  rhr: "Resting HR",
  sleep: "Sleep",
  breathing: "Breathing",
};

export function tuningReport(r: TuningResult): string {
  return [
    `# Recovery tuning, ${r.from} to ${r.to}`,
    "",
    verdict(r),
    "",
    "| Weight | Now | Re-fit |",
    "| --- | --- | --- |",
    ...WEIGHT_KEYS.map((k) => `| ${LABELS[k]} | ${r.current[k]} | ${r.refit.weights[k]} |`),
    "",
    `- Rated mornings used: ${r.refit.rated}`,
    `- Held-out mornings (walk-forward, last 4 weeks): ${r.heldOut.mornings}`,
    `- Agreement with feel on those mornings: now ${fmt(r.heldOut.current)}, re-fit ${fmt(r.heldOut.refit)}`,
    `- Change to past recovery: ${r.moved.meanAbs.toFixed(1)} points on average, at most ${r.moved.maxAbs.toFixed(1)}${r.moved.maxDate ? ` (${r.moved.maxDate})` : ""}`,
    "",
  ].join("\n");
}

function verdict(r: TuningResult): string {
  if (r.refit.status === "not-enough-data") {
    return `Not enough check-ins yet: ${r.refit.rated} rated mornings, ${MIN_RATED} needed. Weights unchanged.`;
  }
  if (r.refit.status === "no-signal") {
    return "Recovery doesn't track how you feel yet (no positive relationship), so there is nothing to tune toward. Weights unchanged.";
  }
  if (r.worthApplying) {
    return "The re-fit agrees better with how you felt on mornings it never saw. Worth applying.";
  }
  return `Not worth applying: it needs at least +${MIN_GAIN} agreement on unseen mornings and no day moving more than ${MAX_DAY_SHIFT} points.`;
}

function fmt(v: number | null): string {
  return v === null ? "n/a" : v.toFixed(2);
}
