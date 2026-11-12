// The stage-fit report: what EM found, which guardrail stopped it if any, and what it does to
// each night's light, deep and REM.

import { FITTED_FEATURES, type FittedFeature, SLEEP_STAGES } from "../metrics/sleep-stages";
import { PRIOR_EPOCHS, SD_FLOOR } from "./stage-em";
import {
  type Guardrail,
  MAX_MEAN_STEP,
  MIN_NIGHTS,
  MIN_PLAUSIBLE,
  type Shares,
  type StageFit,
} from "./stage-fit";

const LABELS: Record<FittedFeature, string> = {
  hrvZ: "HRV",
  breathingZ: "Breathing regularity",
  dfaZ: "DFA α1",
};

export function stageFitReport(r: StageFit & { from: string; to: string }): string {
  return [
    `# Sleep-stage fit, ${r.from} to ${r.to}`,
    "",
    verdict(r),
    "",
    "| Feature | Stage | Mean now | Mean fitted | SD now | SD fitted |",
    "| --- | --- | --- | --- | --- | --- |",
    ...emissionRows(r),
    "",
    ...fitLines(r),
    "",
    "| Night | Now (L/D/R) | Fitted (L/D/R) |",
    "| --- | --- | --- |",
    ...r.perNight.map((n) => `| ${n.date} | ${fmtShares(n.before)} | ${fmtShares(n.after)} |`),
    "",
  ].join("\n");
}

function verdict(r: StageFit): string {
  if (r.failed.length === 0) {
    return "Every guardrail passed. Worth applying.";
  }
  return `Not worth applying: ${r.failed.map((g) => reason(g, r)).join("; ")}.`;
}

function reason(guardrail: Guardrail, r: StageFit): string {
  const reasons: Record<Guardrail, () => string> = {
    nights: () => `${r.nights} nights with stages, ${MIN_NIGHTS} needed`,
    order: () => `the fit turns round ${r.disordered.join(", ")}`,
    plausible: () =>
      `${r.plausibleAfter} of ${r.nights} nights plausible after, at least ${Math.ceil(MIN_PLAUSIBLE * r.nights)} needed`,
  };
  return reasons[guardrail]();
}

function emissionRows(r: StageFit): string[] {
  return FITTED_FEATURES.flatMap((k) =>
    SLEEP_STAGES.map((stage) => {
      const now = r.current[stage][k];
      const fitted = r.fitted[stage][k];
      return `| ${LABELS[k]} | ${stage} | ${fmt(now.mean)} | ${fmt(fitted.mean)} | ${fmt(now.sd)} | ${fmt(fitted.sd)} |`;
    }),
  );
}

function fitLines(r: StageFit): string[] {
  const lines = [`- Nights: ${r.nights}`];
  if (r.em) {
    lines.push(
      `- Log-likelihood: ${r.em.logLik.start.toFixed(1)} now, ${r.em.logLik.end.toFixed(1)} after EM, ${(r.logLik ?? 0).toFixed(1)} after the cap`,
      `- Iterations: ${r.em.iterations}${r.em.converged ? "" : " (stopped before converging)"}`,
      `- Prior: the current values, worth ${PRIOR_EPOCHS} epochs`,
      `- Means held to ±${MAX_MEAN_STEP}: ${list(r.capped)}`,
      `- SDs at the ${SD_FLOOR} floor: ${list(r.em.floored)}`,
    );
  }
  lines.push(
    `- Plausible nights: ${r.plausibleBefore} now, ${r.em ? r.plausibleAfter : "n/a"} fitted`,
  );
  return lines;
}

function list(items: string[]): string {
  return items.length > 0 ? items.join(", ") : "none";
}

function fmtShares(s: Shares | null): string {
  if (!s) {
    return "n/a";
  }
  const pct = (v: number) => Math.round(v * 100);
  return `${pct(s.light)}/${pct(s.deep)}/${pct(s.rem)}${s.plausible ? "" : " unusual"}`;
}

function fmt(v: number): string {
  return v.toFixed(2);
}
