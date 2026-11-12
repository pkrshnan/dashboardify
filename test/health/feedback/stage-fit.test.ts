import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fitEmissions, PRIOR_EPOCHS, SD_FLOOR } from "../../../src/health/feedback/stage-em";
import {
  capSteps,
  fitStages,
  MAX_MEAN_STEP,
  outOfOrder,
  type StageNight,
} from "../../../src/health/feedback/stage-fit";
import { stageFitReport } from "../../../src/health/feedback/stage-report";
import { applyStages } from "../../../src/health/fit-stages";
import { EPOCH_MS } from "../../../src/health/metrics/sleep-epochs";
import type { EpochFeatures } from "../../../src/health/metrics/sleep-features";
import {
  DEFAULT_EMISSIONS,
  FITTED_FEATURES,
  type FittedFeature,
  SLEEP_STAGES,
  type SleepStage,
  type StageEmissions,
} from "../../../src/health/metrics/sleep-stages";
import { DEFAULT_PARAMS, ParamsStore, parseParams } from "../../../src/health/params";
import { T0, whiteNoise } from "../metrics/fixtures";

type Levels = Record<SleepStage, Record<FittedFeature, number>>;

/** Levels unlike the hand-set ones, in the literature's direction. */
const TRUE_LEVELS: Levels = {
  light: { hrvZ: -0.3, breathingZ: 0.2, dfaZ: 0.1 },
  deep: { hrvZ: 1.4, breathingZ: 1.2, dfaZ: -1.1 },
  rem: { hrvZ: -1.2, breathingZ: -1.3, dfaZ: 1.0 },
};
const NOISE_SD = 0.5;

/**
 * 90-minute cycles of light, deep, light and REM, all asleep with no HR, so only the fitted
 * features and the trained transitions say which stage an epoch is.
 */
function cycleStage(minute: number): SleepStage {
  const m = minute % 90;
  if (m < 25) {
    return "light";
  }
  if (m < 55) {
    return "deep";
  }
  return m < 70 ? "light" : "rem";
}

function syntheticNight(seed: number, levels: Levels, minutes = 480): EpochFeatures[] {
  const n = minutes * 2;
  const noise = FITTED_FEATURES.map((_, k) => whiteNoise(n, seed * 10 + k));
  return Array.from({ length: n }, (_, i) => {
    const stage = cycleStage(i / 2);
    const value = (k: number) =>
      levels[stage][FITTED_FEATURES[k] ?? "hrvZ"] + NOISE_SD * (noise[k]?.[i] ?? 0);
    return {
      ts: T0 + i * EPOCH_MS,
      asleep: true,
      arousal: false,
      hrZ: 0,
      hrvZ: value(0),
      breathingZ: value(1),
      dfaZ: value(2),
      movementDeg: 0,
      sinceOnsetMin: i / 2,
    };
  });
}

function nights(count: number, levels: Levels, minutes?: number): StageNight[] {
  return Array.from({ length: count }, (_, i) => ({
    date: `2026-11-${String(i + 1).padStart(2, "0")}`,
    features: syntheticNight(i + 1, levels, minutes),
  }));
}

function eachPair(f: (stage: SleepStage, key: FittedFeature) => void): void {
  for (const stage of SLEEP_STAGES) {
    for (const key of FITTED_FEATURES) {
      f(stage, key);
    }
  }
}

describe("stage EM", () => {
  test("recovers the per-stage levels of synthetic nights", () => {
    const fit = fitEmissions(
      nights(8, TRUE_LEVELS).map((n) => n.features),
      DEFAULT_EMISSIONS,
    );

    expect(fit.converged).toBe(true);
    expect(fit.logLik.end).toBeGreaterThan(fit.logLik.start);
    eachPair((stage, key) => {
      expect(Math.abs(fit.emissions[stage][key].mean - TRUE_LEVELS[stage][key])).toBeLessThan(0.25);
      expect(fit.emissions[stage][key].sd).toBeLessThan(NOISE_SD + 0.25);
    });
  });

  test("with few epochs the prior holds the levels near the current ones", () => {
    const epochs = 40;
    const night = syntheticNight(1, TRUE_LEVELS, epochs / 2).map((f) => ({
      ...f,
      hrvZ: 2,
      breathingZ: 2,
      dfaZ: 2,
    }));

    const fit = fitEmissions([night], DEFAULT_EMISSIONS);

    // No stage can have more than every epoch, so none moves over 40/240 of the way to 2.
    const most = epochs / (epochs + PRIOR_EPOCHS);
    eachPair((stage, key) => {
      const now = DEFAULT_EMISSIONS[stage][key].mean;
      const moved = fit.emissions[stage][key].mean - now;
      expect(moved).toBeGreaterThanOrEqual(0);
      expect(moved).toBeLessThanOrEqual((2 - now) * most + 1e-9);
    });
  });

  test("SDs stop at the floor", () => {
    const flat = syntheticNight(1, TRUE_LEVELS).map((f) => ({ ...f, dfaZ: 0 }));
    const tight: StageEmissions = {
      ...DEFAULT_EMISSIONS,
      deep: { ...DEFAULT_EMISSIONS.deep, dfaZ: { mean: 0, sd: 0.01 } },
    };

    const fit = fitEmissions([flat], tight);

    expect(fit.emissions.deep.dfaZ.sd).toBe(SD_FLOOR);
    expect(fit.floored).toContain("deep dfaZ");
  });
});

describe("stage fit guardrails", () => {
  test("passes on nights that look like typical sleep", () => {
    const fit = fitStages(nights(6, TRUE_LEVELS), DEFAULT_EMISSIONS);

    expect(fit.failed).toEqual([]);
    expect(fit.perNight).toHaveLength(6);
    expect(fit.plausibleAfter).toBe(6);
  });

  test("rejects too few nights without fitting", () => {
    const fit = fitStages(nights(4, TRUE_LEVELS, 120), DEFAULT_EMISSIONS);

    expect(fit.failed).toEqual(["nights"]);
    expect(fit.em).toBeNull();
    expect(fit.fitted).toEqual(DEFAULT_EMISSIONS);
    expect(stageFitReport({ ...fit, from: "2026-11-01", to: "2026-11-04" })).toContain(
      "4 nights with stages, 5 needed",
    );
  });

  test("rejects a fit that turns the literature's order round", () => {
    // DFA α1 higher in deep than in light, against Penzel 2003.
    const flipped: Levels = {
      ...TRUE_LEVELS,
      light: { ...TRUE_LEVELS.light, dfaZ: -1 },
      deep: { ...TRUE_LEVELS.deep, dfaZ: 1 },
    };

    const fit = fitStages(nights(6, flipped), DEFAULT_EMISSIONS);

    expect(fit.failed).toContain("order");
    expect(fit.disordered).toContain("dfaZ deep < light");
    expect(outOfOrder(DEFAULT_EMISSIONS)).toEqual([]);
  });

  test("rejects a fit that leaves most nights implausible", () => {
    // Every epoch looks deep: far more deep sleep than any lab night.
    const allDeep: Levels = {
      light: TRUE_LEVELS.deep,
      deep: TRUE_LEVELS.deep,
      rem: TRUE_LEVELS.deep,
    };

    const fit = fitStages(nights(6, allDeep), DEFAULT_EMISSIONS);

    expect(fit.failed).toContain("plausible");
    expect(fit.plausibleAfter).toBeLessThan(5);
  });

  test("caps how far a mean moves in one apply", () => {
    const far: StageEmissions = {
      ...DEFAULT_EMISSIONS,
      rem: { ...DEFAULT_EMISSIONS.rem, dfaZ: { mean: 2, sd: 0.7 } },
    };

    const { emissions, capped } = capSteps(far, DEFAULT_EMISSIONS);

    expect(emissions.rem.dfaZ.mean).toBe(DEFAULT_EMISSIONS.rem.dfaZ.mean + MAX_MEAN_STEP);
    expect(emissions.rem.dfaZ.sd).toBe(0.7);
    expect(capped).toEqual(["rem dfaZ"]);
  });
});

describe("applying stage params", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "stage-params-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("bumps the version, keeps recovery's weights and the old file", async () => {
    const store = new ParamsStore(dir);
    const first = capSteps(DEFAULT_EMISSIONS, DEFAULT_EMISSIONS).emissions;
    const second = {
      ...first,
      deep: { ...first.deep, hrvZ: { mean: 0.5, sd: 0.9 } },
    };

    expect(await applyStages(store, first)).toBe("2");
    expect(await applyStages(store, second)).toBe("3");

    const live = await store.load();
    expect(live).toEqual({ version: "3", recovery: DEFAULT_PARAMS.recovery, stages: second });
    const kept = JSON.parse(await readFile(join(dir, "params", "v2.json"), "utf8"));
    expect(kept.stages).toEqual(first);
  });

  test("params without stages stay valid; malformed stages are rejected", () => {
    expect(parseParams(DEFAULT_PARAMS)).toEqual(DEFAULT_PARAMS);
    const bad = {
      ...DEFAULT_EMISSIONS,
      rem: { ...DEFAULT_EMISSIONS.rem, dfaZ: { mean: 0.5, sd: 0 } },
    };
    expect(parseParams({ ...DEFAULT_PARAMS, stages: bad })).toBeNull();
  });
});
