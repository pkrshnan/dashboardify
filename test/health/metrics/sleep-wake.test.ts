import { describe, expect, test } from "bun:test";
import { EPOCH_MS } from "../../../src/health/metrics/sleep-epochs";
import { nightMetrics } from "../../../src/health/metrics/summary";
import type { Accel, HeartRate } from "../../../src/health/metrics/types";
import { HOUR, random, T0 } from "./fixtures";

const SLEEP = { start: T0 + 5 * HOUR, end: T0 + 13 * HOUR };
const MIN = 60_000;
/** REM stretches, in minutes after lying down: HR up and jumpier, as REM's is. */
const REM = [
  { from: 100, to: 120 },
  { from: 200, to: 230 },
  { from: 300, to: 335 },
  { from: 400, to: 440 },
];
/** A minute of fast beats: scoreEpochs alone counted that as a 1-minute awakening. */
const TWITCH = 215 * MIN;
const AWAKENING = { from: 350 * MIN, to: 355 * MIN };

const at = (ms: number) => SLEEP.start + ms;
const inRem = (ts: number) => REM.some((r) => ts >= at(r.from * MIN) && ts < at(r.to * MIN));
const within = (ts: number, from: number, to: number) => ts >= at(from) && ts < at(to);

/** Restless before and after the window, still in it except where `moving` says. */
function accel(moving: (ts: number) => boolean): Accel[] {
  const rand = random(3);
  const samples: Accel[] = [];
  for (let ts = T0; ts < T0 + 20 * HOUR; ts += 1000) {
    const asleep = ts >= SLEEP.start && ts < SLEEP.end;
    const still = 0.3 + rand() * 0.02;
    const angle = asleep && !moving(ts) ? still : rand() * 60 - 30;
    const rad = (angle * Math.PI) / 180;
    samples.push({ ts, x: Math.cos(rad), y: 0, z: Math.sin(rad) });
  }
  return samples;
}

function heartRate(bpm: (ts: number) => number): HeartRate[] {
  const rand = random(5);
  const samples: HeartRate[] = [];
  for (let ts = T0; ts < T0 + 20 * HOUR; ts += 1000) {
    const asleep = ts >= SLEEP.start && ts < SLEEP.end;
    const base = inRem(ts) ? 57 + (rand() - 0.5) * 6 : 52 + (rand() - 0.5) * 2;
    samples.push({ ts, bpm: asleep ? bpm(ts) || base : 75 });
  }
  return samples;
}

function night(input: { moving: (ts: number) => boolean; bpm: (ts: number) => number }) {
  const result = nightMetrics({
    accel: accel(input.moving),
    heartRate: heartRate(input.bpm),
    rr: [],
    skinTemp: [],
    past: [],
    needMin: 480,
    minutesAfterNoon: (ts) => Math.round((ts - T0) / MIN) + 360,
  });
  const stages = result?.stages?.stages ?? [];
  const bed = result?.bed ?? 0;
  const stageAt = (ts: number) => stages[Math.floor((ts - bed) / EPOCH_MS)];
  return { result, stageAt };
}

describe("awake after onset", () => {
  test("a twitch in REM, a minute of fast beats and an arm shift, stays REM", () => {
    const { result, stageAt } = night({
      moving: (ts) => within(ts, TWITCH, TWITCH + 3000),
      bpm: (ts) => (within(ts, TWITCH, TWITCH + MIN) ? 72 : 0),
    });

    expect(stageAt(at(TWITCH))).toBe("rem");
    expect(stageAt(at(TWITCH + MIN / 2))).toBe("rem");
    expect(result?.awakenings).toBe(0);
  });

  test("a real five-minute awakening stays awake and counts once", () => {
    const { result, stageAt } = night({
      moving: (ts) => within(ts, AWAKENING.from, AWAKENING.to) && (ts / 1000) % 40 < 10,
      bpm: (ts) => (within(ts, AWAKENING.from, AWAKENING.to) ? 72 : 0),
    });

    const epochs = (AWAKENING.to - AWAKENING.from) / EPOCH_MS;
    const awake = Array.from({ length: epochs }, (_, i) =>
      stageAt(at(AWAKENING.from + i * EPOCH_MS)),
    ).filter((s) => s === "awake");
    expect(awake.length).toBeGreaterThanOrEqual(epochs - 1);
    expect(result?.awakenings).toBe(1);
    expect(result?.wakeAfterOnsetMin).toBeGreaterThanOrEqual(4.5);
    expect(result?.wakeAfterOnsetMin).toBeLessThan(7);
  });
});
