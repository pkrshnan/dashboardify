import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  type PastNight,
  ratedNights,
  replay,
  shift,
  walkForward,
  worthApplying,
} from "../../../src/health/feedback/backtest";
import { MAX_STEP, MIN_RATED, refitWeights } from "../../../src/health/feedback/refit";
import { tuningReport } from "../../../src/health/feedback/report";
import type { NightSignals } from "../../../src/health/metrics/recovery";
import { recovery } from "../../../src/health/metrics/recovery";
import { rankCorrelation, ranks, solveLinear } from "../../../src/health/metrics/stats";
import { DEFAULT_PARAMS, nextVersion, ParamsStore, parseParams } from "../../../src/health/params";

/** A small seeded random generator, so the synthetic nights are the same every run. */
function rng(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 1664525 + 1013904223) % 4294967296;
    return s / 4294967296;
  };
}

/** Roughly normal noise: the sum of four uniforms, centred. */
function noise(rand: () => number): number {
  return rand() + rand() + rand() + rand() - 2;
}

/**
 * `count` nights from 2026-01-01 on. HRV, resting HR and sleep vary independently; feel follows
 * resting HR much more than HRV, so a good re-fit should shift weight from HRV to resting HR.
 */
function syntheticNights(count: number, seed = 7): PastNight[] {
  const rand = rng(seed);
  const start = Temporal.PlainDate.from("2026-01-01");
  return Array.from({ length: count }, (_, i) => {
    const hrv = noise(rand);
    const rhr = noise(rand);
    const signals: NightSignals = {
      lnRmssd: 3.8 + 0.15 * hrv,
      restingHr: 52 + 2 * rhr,
      breathingRate: 14 + 0.3 * noise(rand),
      skinTemp: 34.3,
      sleepScore: 75 + 5 * noise(rand),
    };
    const feel = Math.max(
      1,
      Math.min(5, Math.round(3 + 0.3 * hrv - 1.5 * rhr + 0.3 * noise(rand))),
    );
    return { date: start.add({ days: i }).toString(), signals, feel };
  });
}

describe("stats", () => {
  test("ranks share ties", () => {
    expect(ranks([10, 20, 20, 5])).toEqual([2, 3.5, 3.5, 1]);
  });

  test("rank correlation ignores spacing", () => {
    expect(rankCorrelation([1, 2, 3, 4], [1, 10, 100, 1000])).toBeCloseTo(1);
    expect(rankCorrelation([1, 2, 3, 4], [4, 3, 2, 1])).toBeCloseTo(-1);
  });

  test("solves a linear system", () => {
    const x = solveLinear(
      [
        [2, 1],
        [1, 3],
      ],
      [5, 10],
    );
    expect(x?.[0]).toBeCloseTo(1);
    expect(x?.[1]).toBeCloseTo(3);
    expect(
      solveLinear(
        [
          [1, 2],
          [2, 4],
        ],
        [1, 2],
      ),
    ).toBeNull();
  });
});

describe("refitWeights", () => {
  const current = DEFAULT_PARAMS.recovery;

  test("leaves the weights alone before enough check-ins", () => {
    const rated = ratedNights(syntheticNights(30));
    expect(rated.length).toBeLessThan(MIN_RATED);
    const fit = refitWeights(rated, current);
    expect(fit.status).toBe("not-enough-data");
    expect(fit.weights).toEqual(current);
  });

  test("moves weight toward what predicts feel, within the step limit", () => {
    const fit = refitWeights(ratedNights(syntheticNights(150)), current);
    expect(fit.status).toBe("fitted");
    expect(fit.weights.rhr).toBeGreaterThan(current.rhr);
    expect(fit.weights.hrv).toBeLessThan(current.hrv);
    for (const k of ["hrv", "rhr", "sleep", "breathing"] as const) {
      expect(Math.abs(fit.weights[k] - current[k])).toBeLessThanOrEqual(MAX_STEP + 0.001);
      expect(fit.weights[k]).toBeGreaterThanOrEqual(0);
    }
    const total = fit.weights.hrv + fit.weights.rhr + fit.weights.sleep + fit.weights.breathing;
    expect(total).toBeCloseTo(1, 2);
  });

  test("refuses to tune toward a backwards relationship", () => {
    const flipped = ratedNights(syntheticNights(150)).map((n) => ({ ...n, feel: 6 - n.feel }));
    expect(refitWeights(flipped, current).status).toBe("no-signal");
  });
});

describe("backtest", () => {
  test("replay scores a night the same way the daily summary does", () => {
    const nights = syntheticNights(40);
    const scores = replay(nights, DEFAULT_PARAMS.recovery);
    const last = nights.at(-1);
    const expected = last
      ? recovery(
          last.signals,
          nights.slice(0, -1).map((n) => n.signals),
        )
      : null;
    expect(last && scores.get(last.date)).toBeCloseTo(expected?.pct ?? -1);
    expect(scores.size).toBe(40 - 14);
  });

  test("the same weights shift nothing", () => {
    const nights = syntheticNights(60);
    const moved = shift(nights, DEFAULT_PARAMS.recovery, DEFAULT_PARAMS.recovery);
    expect(moved.maxAbs).toBe(0);
  });

  test("walk-forward finds the re-fit agrees better on unseen mornings", () => {
    const nights = syntheticNights(150);
    const heldOut = walkForward(nights, DEFAULT_PARAMS.recovery);
    expect(heldOut.mornings).toBe(28);
    expect(heldOut.refit ?? 0).toBeGreaterThan(heldOut.current ?? 1);
  });

  test("worthApplying needs a real gain and no wild swings", () => {
    const calm = { days: 100, meanAbs: 3, maxAbs: 10, maxDate: null };
    expect(worthApplying({ mornings: 28, current: 0.3, refit: 0.4 }, calm)).toBe(true);
    expect(worthApplying({ mornings: 28, current: 0.3, refit: 0.32 }, calm)).toBe(false);
    expect(worthApplying({ mornings: 28, current: 0.3, refit: 0.4 }, { ...calm, maxAbs: 40 })).toBe(
      false,
    );
  });

  test("the report says why nothing changed", () => {
    const nights = syntheticNights(30);
    const refit = refitWeights(ratedNights(nights), DEFAULT_PARAMS.recovery);
    const text = tuningReport({
      from: "2026-01-01",
      to: "2026-01-30",
      current: DEFAULT_PARAMS.recovery,
      refit,
      heldOut: walkForward(nights, DEFAULT_PARAMS.recovery),
      moved: shift(nights, DEFAULT_PARAMS.recovery, refit.weights),
      worthApplying: false,
    });
    expect(text).toContain("Not enough check-ins yet");
    expect(text).toContain("| HRV | 0.5 | 0.5 |");
  });
});

describe("ParamsStore", () => {
  let dir: string;
  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "params-"));
  });
  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  test("falls back to the defaults, then keeps what was saved", async () => {
    const store = new ParamsStore(dir);
    expect(await store.load()).toEqual(DEFAULT_PARAMS);
    const next = { version: "2", recovery: { hrv: 0.45, rhr: 0.35, sleep: 0.12, breathing: 0.08 } };
    await store.save(next);
    expect(await store.load()).toEqual(next);
    expect(JSON.parse(await readFile(join(dir, "params", "v2.json"), "utf8"))).toEqual(next);
  });

  test("rejects malformed params", () => {
    expect(
      parseParams({ version: "2", recovery: { hrv: -1, rhr: 0, sleep: 0, breathing: 0 } }),
    ).toBeNull();
    expect(parseParams({ recovery: DEFAULT_PARAMS.recovery })).toBeNull();
  });

  test("versions count up", () => {
    expect(nextVersion("1")).toBe("2");
    expect(nextVersion("9")).toBe("10");
  });
});
