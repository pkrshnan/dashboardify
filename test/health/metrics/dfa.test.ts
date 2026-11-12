import { describe, expect, test } from "bun:test";
import { dfaAlpha1, MIN_DFA_BEATS } from "../../../src/health/metrics/dfa";
import { pinkNoise, whiteNoise } from "./fixtures";

/** The mean α1 over five seeds, since one 300-beat series wanders by about ±0.05. */
function meanAlpha(make: (seed: number) => number[]): number {
  const values = [1, 2, 3, 4, 5].map((seed) => dfaAlpha1(make(seed)) ?? Number.NaN);
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

describe("DFA α1", () => {
  test("white noise is uncorrelated: about 0.5", () => {
    const alpha = meanAlpha((seed) => whiteNoise(300, seed));

    // Short series run a little high (about 0.55 here), as at 4–16 beats everywhere.
    expect(alpha).toBeGreaterThan(0.45);
    expect(alpha).toBeLessThan(0.65);
  });

  test("1/f noise is about 1.0", () => {
    expect(meanAlpha((seed) => pinkNoise(300, seed))).toBeCloseTo(1, 1);
  });

  test("a random walk is about 1.5", () => {
    const walk = (seed: number) => {
      let total = 0;
      return whiteNoise(300, seed).map((v) => {
        total += v;
        return total;
      });
    };

    expect(meanAlpha(walk)).toBeGreaterThan(1.3);
  });

  test("doesn't depend on the units or the mean", () => {
    const noise = pinkNoise(300, 1);
    const gaps = noise.map((v) => 1000 + 30 * v);

    expect(dfaAlpha1(gaps)).toBeCloseTo(dfaAlpha1(noise) ?? Number.NaN, 9);
  });

  test("null under the minimum beats, or for a flat series", () => {
    expect(dfaAlpha1(whiteNoise(MIN_DFA_BEATS - 1, 1))).toBeNull();
    expect(dfaAlpha1(whiteNoise(MIN_DFA_BEATS, 1))).not.toBeNull();
    expect(dfaAlpha1(new Array<number>(200).fill(1000))).toBeNull();
  });
});
