import { describe, expect, test } from "bun:test";
import { setSpans } from "../../../src/health/metrics/set-edges";
import type { SetClimb } from "../../../src/health/metrics/sets";
import type { Motion, StepCounter } from "../../../src/health/metrics/types";
import { T0 } from "./fixtures";

const S = 1000;

/** A climb from its low point to its peak, in seconds after T0. */
const climb = (start: number, peak: number): SetClimb => ({
  start: T0 + start * S,
  peak: T0 + peak * S,
  peakHr: 130,
  climb: 30,
});

/** Motion once a second over `seconds`: 0.2 inside the moving stretches, 0.015 resting. */
function motion(seconds: number, moving: [number, number][]): Motion[] {
  return Array.from({ length: seconds }, (_, s) => ({
    ts: T0 + s * S,
    intensity: moving.some(([a, b]) => s >= a && s < b) ? 0.2 : 0.015,
  }));
}

/** The step counter once a second, two steps a second inside `walking`. */
function steps(seconds: number, walking: [number, number][]): StepCounter[] {
  let count = 1000;
  return Array.from({ length: seconds }, (_, s) => {
    count += walking.some(([a, b]) => s >= a && s < b) ? 2 : 0;
    return { ts: T0 + s * S, count };
  });
}

/** Spans as seconds after T0. */
const seconds = (spans: { start: number; end: number; byMotion: boolean }[]) =>
  spans.map((s) => [Math.round((s.start - T0) / S), Math.round((s.end - T0) / S), s.byMotion]);

describe("set spans", () => {
  test("edges come from motion: a start before the HR low point and an end before the peak", () => {
    // The set moves 400–450 s. HR's low point is at 370 s, and it peaks 25 s after you stop.
    const spans = setSpans([climb(370, 475)], motion(900, [[400, 450]]), []);

    // Smoothing over 11 s widens the run by about 5 s each side.
    expect(seconds(spans)).toEqual([[396, 454, true]]);
  });

  test("walking to the next station isn't the set", () => {
    const spans = setSpans([climb(380, 470)], motion(900, [[300, 450]]), steps(900, [[300, 395]]));

    // Walking ends at 395 s; steps are counted over 10 s, so the set starts within 5 s of it.
    const [span] = seconds(spans);
    expect(span?.[0]).toBeGreaterThanOrEqual(390);
    expect(span?.[2]).toBe(true);
  });

  test("two sets in one run of motion keep their climbs' edges", () => {
    const spans = setSpans([climb(370, 440), climb(470, 540)], motion(900, [[380, 550]]), []);

    expect(seconds(spans)).toEqual([
      [370, 440, false],
      [470, 540, false],
    ]);
  });

  test("a run too long to be one set gives its end but not its start", () => {
    // Setting up and the set run together for 3 minutes; HR's low point marks the start.
    const spans = setSpans([climb(400, 470)], motion(900, [[300, 480]]), []);

    expect(seconds(spans)).toEqual([[400, 484, true]]);
  });

  test("with no motion the climb stands", () => {
    expect(seconds(setSpans([climb(370, 440)], [], []))).toEqual([[370, 440, false]]);
  });

  test("a set never starts before the last one ended", () => {
    // HR's second low point falls inside the first set.
    const spans = setSpans(
      [climb(300, 360), climb(340, 480)],
      motion(900, [
        [310, 350],
        [420, 470],
      ]),
      [],
    );

    const [first, second] = seconds(spans);
    expect(Number(second?.[0])).toBeGreaterThanOrEqual(Number(first?.[1]));
  });
});
