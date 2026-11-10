import { describe, expect, test } from "bun:test";
import { EPOCH_MS } from "../../../src/health/metrics/sleep-epochs";
import type { EpochFeatures } from "../../../src/health/metrics/sleep-features";
import type { Stage } from "../../../src/health/metrics/sleep-stages";
import {
  accuracy,
  confusion,
  kappa,
  plausibleBounds,
  recall,
  shares,
} from "../../../src/health/staging/evaluate";
import { fit, target } from "../../../src/health/staging/fit";
import {
  gravity,
  heartRateAt1Hz,
  type LabelledNight,
  parseRows,
  scoredSpan,
} from "../../../src/health/staging/walch";

const T0 = Date.UTC(2019, 0, 1);

describe("reading Walch nights", () => {
  test("rows are numbers only; anything else is dropped", () => {
    const rows = parseRows("0 -1\n30 2\nrm -rf /\n60,5\n90 2 7\n\n", 2);

    expect(rows).toEqual([
      [0, -1],
      [30, 2],
      [60, 5],
    ]);
  });

  test("the window runs from the first scored epoch to the end of the last", () => {
    const span = scoredSpan([
      [0, -1],
      [30, 0],
      [60, 2],
      [90, -1],
    ]);

    expect(span).toEqual({ start: T0 + 30_000, end: T0 + 90_000 });
    expect(scoredSpan([[0, -1]])).toBeNull();
  });

  test("acceleration becomes a 1 Hz mean inside the window", () => {
    const rows = [
      [-1, 9, 9, 9],
      [0, 0, 0, 1],
      [0.5, 0, 0.2, 1],
      [1.2, 1, 0, 0],
    ];

    const accel = gravity(rows, { start: T0, end: T0 + 2000 });

    expect(accel).toEqual([
      { ts: T0, x: 0, y: 0.1, z: 1 },
      { ts: T0 + 1000, x: 1, y: 0, z: 0 },
    ]);
  });

  test("HR is interpolated to 1 Hz, but long gaps stay gaps", () => {
    const rows = [
      [0, 60],
      [4, 64],
      [100, 70],
    ];

    const hr = heartRateAt1Hz(rows, { start: T0, end: T0 + 10_000 });

    expect(hr.map((h) => h.bpm)).toEqual([60, 61, 62, 63, 64]);
  });
});

/** A night of `stages`, asleep except where the stage is awake, HR z by stage. */
function labelled(stages: Stage[], hrBy: Record<Stage, number>): LabelledNight {
  const features: EpochFeatures[] = stages.map((s, i) => ({
    ts: T0 + i * EPOCH_MS,
    asleep: s !== "awake",
    hrZ: hrBy[s] + (i % 2 === 0 ? 0.1 : -0.1),
    hrvZ: null,
    breathingZ: null,
    movementDeg: s === "light" && i % 10 === 0 ? 8 : 0,
    sinceOnsetMin: i / 2,
  }));
  return { id: "x", features, truth: stages };
}

describe("fitting", () => {
  const stages: Stage[] = [
    ...new Array<Stage>(40).fill("light"),
    ...new Array<Stage>(40).fill("deep"),
    ...new Array<Stage>(40).fill("light"),
    ...new Array<Stage>(40).fill("rem"),
  ];
  const night = labelled(stages, { awake: 0, light: 0, deep: 0, rem: 0 });

  test("movement shows where the lab says it happened", () => {
    const params = fit([night]);

    expect(params.movement.p.light[3] ?? 0).toBeGreaterThan(params.movement.p.deep[3] ?? 1);
    expect(params.movement.p.deep.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 3);
  });

  test("each stage stays put most epochs, and rows are distributions", () => {
    const params = fit([night]);
    const [, light, deep] = params.transitions.sinceOnset[0] ?? [];

    expect(light?.[1] ?? 0).toBeGreaterThan(0.9);
    expect(deep?.reduce((sum, v) => sum + v, 0)).toBeCloseTo(1, 3);
  });

  test("the target keeps scoreEpochs' awake and counts lab wake in scored sleep as light", () => {
    const n: LabelledNight = {
      ...night,
      features: night.features.slice(0, 3).map((f, i) => ({ ...f, asleep: i !== 0 })),
      truth: ["light", "awake", null],
    };

    expect(target(n)).toEqual(["awake", "light", null]);
  });
});

describe("scoring", () => {
  const held = {
    id: "x",
    truth: ["awake", "light", "light", "deep", "rem", null] as (Stage | null)[],
    predicted: ["awake", "light", "deep", "deep", "light", "rem"] as Stage[],
  };

  test("accuracy, kappa and recall over the scored epochs", () => {
    const matrix = confusion([held]);

    expect(accuracy(matrix)).toBeCloseTo(3 / 5, 9);
    expect(recall(matrix)).toEqual([1, 0.5, 1, 0]);
    // Chance: (1·1 + 2·2 + 1·2 + 1·0) / 25 = 7/25.
    expect(kappa(matrix)).toBeCloseTo((3 / 5 - 7 / 25) / (1 - 7 / 25), 9);
    expect(kappa(confusion([{ ...held, predicted: held.truth.map((t) => t ?? "awake") }]))).toBe(1);
  });

  test("shares are of asleep epochs", () => {
    expect(shares(["awake", "light", "deep", "rem", "light"])).toEqual({
      light: 0.5,
      deep: 0.25,
      rem: 0.25,
    });
  });

  test("bounds span the held-out spread and skip short nights", () => {
    const night = (light: number, deep: number, rem: number): typeof held => ({
      id: "n",
      truth: [],
      predicted: [
        ...new Array<Stage>(light).fill("light"),
        ...new Array<Stage>(deep).fill("deep"),
        ...new Array<Stage>(rem).fill("rem"),
      ],
    });
    const nights = [
      night(500, 200, 300),
      night(600, 150, 250),
      night(550, 250, 200),
      night(1, 0, 0),
    ];

    const bounds = plausibleBounds(nights, 300);

    expect(bounds.light[0] ?? 1).toBeLessThan(0.5);
    expect(bounds.light[1] ?? 0).toBeGreaterThan(0.6);
    expect(bounds.light[1] ?? 0).toBeLessThanOrEqual(1);
  });
});
