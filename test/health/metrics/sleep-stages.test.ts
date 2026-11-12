import { describe, expect, test } from "bun:test";
import { EPOCH_MS } from "../../../src/health/metrics/sleep-epochs";
import type { EpochFeatures } from "../../../src/health/metrics/sleep-features";
import {
  STAGE_PARAMS,
  type Stage,
  sleepStages,
  transitions,
} from "../../../src/health/metrics/sleep-stages";
import { random, T0 } from "./fixtures";

const NIGHT_MIN = 480;

type Look = Pick<EpochFeatures, "hrZ" | "hrvZ" | "breathingZ" | "dfaZ">;

const DEEP: Look = { hrZ: -1.2, hrvZ: 1, breathingZ: 1, dfaZ: -0.8 };
const REM: Look = { hrZ: 1, hrvZ: -0.8, breathingZ: -1, dfaZ: 0.8 };

/**
 * An all-asleep night, onset at the first epoch, with features scattered ±0.3 around 0 (light),
 * and `marked` stretches (in minutes since onset) that look like a stage.
 */
function night(marked: { from: number; to: number; look: Look }[] = []): EpochFeatures[] {
  const rand = random(9);
  const jitter = () => (rand() - 0.5) * 0.6;
  return Array.from({ length: NIGHT_MIN * 2 }, (_, i) => {
    const t = i / 2;
    const look = marked.find((m) => t >= m.from && t < m.to)?.look;
    return {
      ts: T0 + i * EPOCH_MS,
      asleep: true,
      arousal: false,
      hrZ: (look?.hrZ ?? 0) + jitter(),
      hrvZ: (look?.hrvZ ?? 0) + jitter(),
      breathingZ: (look?.breathingZ ?? 0) + jitter(),
      dfaZ: (look?.dfaZ ?? 0) + jitter(),
      movementDeg: 0,
      sinceOnsetMin: t,
    };
  });
}

/** The share of epochs from `from` to `to` minutes decoded as `stage`. */
function share(stages: Stage[], stage: Stage, from: number, to: number): number {
  const slice = stages.slice(from * 2, to * 2);
  return slice.filter((s) => s === stage).length / slice.length;
}

describe("sleep stages", () => {
  test("an early low-HR, high-HRV, regular-breathing stretch is deep", () => {
    const result = sleepStages(night([{ from: 40, to: 80, look: DEEP }]));

    expect(share(result?.stages ?? [], "deep", 45, 75)).toBeGreaterThan(0.9);
    expect(share(result?.stages ?? [], "deep", 120, NIGHT_MIN)).toBe(0);
  });

  test("a late, still, higher-HR, low-HRV stretch is REM", () => {
    const result = sleepStages(night([{ from: 360, to: 390, look: REM }]));

    expect(share(result?.stages ?? [], "rem", 365, 385)).toBeGreaterThan(0.9);
    expect(result?.remMin).toBeLessThan(40);
  });

  test("no REM in the first 45 minutes, even when it looks like REM", () => {
    const result = sleepStages(
      night([
        { from: 15, to: 40, look: REM },
        { from: 200, to: 225, look: REM },
      ]),
    );

    expect(share(result?.stages ?? [], "rem", 0, 45)).toBe(0);
    expect(share(result?.stages ?? [], "rem", 205, 220)).toBeGreaterThan(0.9);
  });

  test("before onset, scoreEpochs' awake stays awake and its asleep epochs are never awake", () => {
    const awake = (i: number) => i < 6 || i === 12;
    const features = night([{ from: 140, to: 160, look: DEEP }]).map((f, i) => ({
      ...f,
      asleep: !awake(i),
      sinceOnsetMin: (i - 20) / 2,
    }));

    const stages = sleepStages(features)?.stages ?? [];

    expect(stages).toHaveLength(features.length);
    expect(stages.slice(0, 20).map((s) => s === "awake")).toEqual(
      features.slice(0, 20).map((f) => !f.asleep),
    );
  });

  test("after onset, one fast-HR epoch scoreEpochs called awake is decoded with the rest", () => {
    const features = night([{ from: 200, to: 230, look: REM }]).map((f, i) =>
      i === 430 ? { ...f, asleep: false, arousal: true, hrZ: 2.5 } : f,
    );

    const stages = sleepStages(features)?.stages ?? [];

    expect(stages[430]).toBe("rem");
    expect(stages.filter((s) => s === "awake")).toHaveLength(0);
  });

  test("stage and awake minutes add up to the night, and the runs cover it", () => {
    const features = night([
      { from: 30, to: 70, look: DEEP },
      { from: 150, to: 170, look: REM },
    ]).map((f, i) => ({ ...f, asleep: i >= 6, sinceOnsetMin: (i - 6) / 2 }));

    const result = sleepStages(features);
    const runs = result?.runs ?? [];

    const awakeMin = ((result?.stages ?? []).filter((s) => s === "awake").length * EPOCH_MS) / 6e4;
    expect(
      (result?.lightMin ?? 0) + (result?.deepMin ?? 0) + (result?.remMin ?? 0) + awakeMin,
    ).toBe(NIGHT_MIN);
    // Awake before onset is fixed; after it, the decoder may carry it on an epoch or two.
    expect(runs[0]).toMatchObject({ start: T0, stage: "awake" });
    expect(runs[0]?.end ?? 0).toBeGreaterThanOrEqual(T0 + 6 * EPOCH_MS);
    expect(runs[runs.length - 1]?.end).toBe(T0 + NIGHT_MIN * 60_000);
    expect(runs.every((r, i) => i === 0 || r.start === runs[i - 1]?.end)).toBe(true);
    expect(runs.every((r, i) => i === 0 || r.stage !== runs[i - 1]?.stage)).toBe(true);
  });

  test("a night with lab-like shares is plausible; one with no deep or REM isn't", () => {
    // 75 min deep (16%) early, 110 min REM (23%) through the night: 61% light.
    const cycles = night([
      { from: 20, to: 65, look: DEEP },
      { from: 110, to: 140, look: DEEP },
      { from: 90, to: 105, look: REM },
      { from: 200, to: 225, look: REM },
      { from: 300, to: 330, look: REM },
      { from: 400, to: 440, look: REM },
    ]);

    const result = sleepStages(cycles);

    expect(result?.deepMin).toBeGreaterThan(0.1 * NIGHT_MIN);
    expect(result?.remMin).toBeGreaterThan(0.15 * NIGHT_MIN);
    expect(result?.plausible).toBe(true);
    expect(sleepStages(night())?.plausible).toBe(false);
  });

  test("with every feature null after onset the night reads as a strap gap, awake", () => {
    const features = night().map((f) => ({
      ...f,
      hrZ: null,
      hrvZ: null,
      breathingZ: null,
      dfaZ: null,
    }));

    const stages = sleepStages(features)?.stages ?? [];

    expect(stages).toHaveLength(features.length);
    expect(stages.filter((s) => s === "awake").length).toBeGreaterThan(0.95 * stages.length);
  });

  test("without onset, time counts from the first epoch", () => {
    const features = night([{ from: 40, to: 80, look: DEEP }]).map((f) => ({
      ...f,
      sinceOnsetMin: null,
    }));

    expect(share(sleepStages(features)?.stages ?? [], "deep", 45, 75)).toBeGreaterThan(0.9);
  });

  test("nothing to stage without an asleep epoch", () => {
    expect(sleepStages([])).toBeNull();
    expect(sleepStages(night().map((f) => ({ ...f, asleep: false })))).toBeNull();
  });
});

describe("stage transitions", () => {
  const p = (log: number) => Math.exp(log);

  test("each row is a probability distribution", () => {
    for (const t of [-10, 0, 30, 50, 90, 300, 600]) {
      for (const row of transitions(t)) {
        expect(row.map(p).reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 9);
      }
    }
  });

  test("deep is entered mostly early, REM only after 45 minutes and more late", () => {
    const [, light] = transitions(45);
    const [, lateLight] = transitions(400);

    expect(p(light?.[2] ?? 0)).toBeGreaterThan(4 * p(lateLight?.[2] ?? 0));
    expect(p(transitions(-5)[1]?.[3] ?? 0)).toBe(0);
    expect(p(transitions(30)[1]?.[3] ?? 0)).toBe(0);
    expect(p(transitions(30)[0]?.[3] ?? 0)).toBe(0);
    expect(p(lateLight?.[3] ?? 0)).toBeGreaterThan(2 * p(transitions(100)[1]?.[3] ?? 0));
  });

  test("deep and REM rarely switch directly", () => {
    const [, , deep, rem] = transitions(200);

    expect(p(deep?.[3] ?? 0)).toBeLessThan(p(deep?.[1] ?? 0) / 50);
    expect(p(rem?.[2] ?? 0)).toBeLessThan(p(rem?.[1] ?? 0) / 20);
  });
});

describe("stage params", () => {
  const rowsSumToOne = (matrix: number[][]) =>
    matrix.every((row) => Math.abs(row.reduce((sum, v) => sum + v, 0) - 1) < 1e-3);

  test("the fitted file loads with the shape the model reads", () => {
    const { hr, movement, transitions: t, plausible, provenance } = STAGE_PARAMS;

    expect(provenance.licence).toContain("ODC-BY 1.0");
    expect(provenance.version).toBe("1.0.0");
    for (const stage of ["light", "deep", "rem"] as const) {
      expect(hr[stage].sd).toBeGreaterThan(0);
      expect(movement.p[stage]).toHaveLength(movement.edgesDeg.length + 1);
      expect(plausible[stage]).toHaveLength(2);
      expect(plausible[stage][0] ?? 1).toBeLessThan(plausible[stage][1] ?? 0);
    }
    expect(t.sinceOnset.length).toBeGreaterThan(1);
    for (const matrix of [t.beforeOnset, ...t.sinceOnset]) {
      expect(matrix).toHaveLength(4);
      expect(matrix.every((row) => row.length === 4 && row.every((v) => v > 0))).toBe(true);
      expect(rowsSumToOne(matrix)).toBe(true);
    }
  });
});
