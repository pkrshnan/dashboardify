import { describe, expect, test } from "bun:test";
import { setClimbs } from "../../../src/health/metrics/sets";
import { heartRate, random, T0 } from "./fixtures";

const SET_S = 45;
const REST_S = 120;

/** 0 to 1 through a set, then back to 0 over the first minute of rest. */
function effort(secondsIntoCycle: number): number {
  if (secondsIntoCycle < SET_S) {
    return secondsIntoCycle / SET_S;
  }
  return Math.max(0, 1 - (secondsIntoCycle - SET_S) / 60);
}

/** HR at 1 Hz: `sets` climbs of `climb` bpm from 100, each followed by a rest, plus noise. */
function session(sets: number, climb: (i: number) => number, noise = 2) {
  const rand = random(5);
  const cycle = SET_S + REST_S;
  const end = T0 + (sets * cycle + 60) * 1000;
  return heartRate(T0, end, (ts) => {
    const s = (ts - T0) / 1000 - 60;
    const i = Math.floor(s / cycle);
    const into = s - i * cycle;
    const lift = s < 0 || i >= sets ? 0 : effort(into);
    return 100 + lift * climb(i) + (rand() - 0.5) * noise;
  });
}

describe("set climbs", () => {
  test("finds each set's climb, in order", () => {
    const samples = session(12, () => 20);
    const span = { start: T0, end: T0 + 3_600_000 };

    const climbs = setClimbs(samples, span, 12);

    expect(climbs).toHaveLength(12);
    // Each set peaks at the end of its 45 seconds, one cycle apart.
    const peaks = (climbs ?? []).map((c) => (c.peak - T0) / 1000);
    for (const [i, p] of peaks.entries()) {
      expect(Math.abs(p - (60 + i * 165 + SET_S))).toBeLessThanOrEqual(10);
    }
    expect(climbs?.every((c) => c.climb > 14)).toBe(true);
  });

  test("small warm-up climbs still count when the log says they happened", () => {
    const samples = session(4, (i) => (i === 0 ? 9 : 22));

    expect(setClimbs(samples, { start: T0, end: T0 + 3_600_000 }, 4)).toHaveLength(4);
  });

  test("a session that starts at its first peak still sees that set's whole climb", () => {
    const samples = session(4, () => 30);
    const first = setClimbs(samples, { start: T0, end: T0 + 3_600_000 }, 4)?.[0];

    const climbs = setClimbs(samples, { start: first?.peak ?? 0, end: T0 + 3_600_000 }, 4);

    expect(climbs?.[0]?.peak).toBe(first?.peak ?? -1);
    expect(climbs?.[0]?.climb).toBeGreaterThan(25);
  });

  test("fewer clear climbs than logged sets is no match", () => {
    const samples = session(8, () => 20);

    expect(setClimbs(samples, { start: T0, end: T0 + 3_600_000 }, 12)).toBeNull();
  });

  test("steady HR has no climbs", () => {
    const samples = heartRate(T0, T0 + 1_800_000, () => 110);

    expect(setClimbs(samples, { start: T0, end: T0 + 1_800_000 }, 3)).toBeNull();
  });
});
