import { describe, expect, test } from "bun:test";
import type { AngleChange } from "../../../src/health/metrics/sleep";
import {
  EPOCH_MS,
  rescore,
  scoreEpochs,
  sleepTimes,
} from "../../../src/health/metrics/sleep-epochs";
import { consistency, sleepNeed, sleepScore } from "../../../src/health/metrics/sleep-score";
import { HOUR, heartRate, T0 } from "./fixtures";

const window = { start: T0, end: T0 + 2 * HOUR };
const still: AngleChange[] = [];
const minute = (n: number) => T0 + n * 60_000;

describe("scoring 30-second epochs", () => {
  test("still with a steady heart rate is asleep the whole time", () => {
    const epochs = scoreEpochs(
      window,
      still,
      heartRate(window.start, window.end, () => 55),
    );
    expect(epochs).toHaveLength(240);
    expect(epochs.every((e) => e.asleep)).toBe(true);
    expect(sleepTimes(window, epochs)).toMatchObject({
      onset: T0,
      asleepMin: 120,
      latencyMin: 0,
      awakenings: 0,
      efficiency: 1,
    });
  });

  test("lying still but awake shows up as a raised heart rate", () => {
    // Awake for the first 20 minutes (HR 70, jumpy), then asleep at 55.
    const bpm = (ts: number) => (ts < minute(20) ? 70 + ((ts / 1000) % 7) * 3 : 55);
    const epochs = scoreEpochs(window, still, heartRate(window.start, window.end, bpm));
    const times = sleepTimes(window, epochs);
    expect(times.latencyMin).toBeGreaterThanOrEqual(15);
    expect(times.asleepMin).toBeLessThan(110);
  });

  test("a posture change mid-sleep is a short awakening", () => {
    const moves = [minute(60), minute(60) + 5000, minute(60) + 35_000].map((ts) => ({
      ts,
      change: 20,
    }));
    const epochs = scoreEpochs(
      window,
      moves,
      heartRate(window.start, window.end, () => 55),
    );
    const times = sleepTimes(window, epochs);
    expect(times.awakenings).toBe(1);
    expect(times.wakeAfterOnsetMin).toBe(1);
  });

  test("no heart rate (strap off) is not counted as sleep", () => {
    const epochs = scoreEpochs(
      window,
      still,
      heartRate(window.start, minute(60), () => 55),
    );
    expect(sleepTimes(window, epochs).asleepMin).toBe(60);
  });

  test("rescoring removes one-epoch flickers", () => {
    expect(rescore([false, true, false, false, true, false, true, true])).toEqual([
      false,
      false,
      false,
      false,
      false,
      true,
      true,
      true,
    ]);
    expect(EPOCH_MS).toBe(30_000);
  });
});

describe("sleep score", () => {
  const usual = { onsetMin: 660, wakeMin: 1140, asleepMin: 480 }; // 23:00 to 07:00

  test("need adds a third of the last three nights' shortfall, up to an hour", () => {
    expect(sleepNeed(480, [usual, usual, usual])).toBe(480);
    const short = { ...usual, asleepMin: 390 };
    expect(sleepNeed(480, [short, short, usual])).toBe(540);
    expect(sleepNeed(480, [usual, short, usual])).toBe(510);
  });

  test("consistency is 100 on your usual times and 0 at 90 minutes off", () => {
    const past = [usual, usual, usual];
    expect(consistency({ onsetMin: 660, wakeMin: 1140 }, past)).toBe(100);
    expect(consistency({ onsetMin: 705, wakeMin: 1185 }, past)).toBe(50);
    expect(consistency({ onsetMin: 800, wakeMin: 1300 }, past)).toBe(0);
    expect(consistency(usual, [usual])).toBeNull();
  });

  test("a full, unbroken, regular night scores 100", () => {
    const night = { ...usual, efficiency: 0.96 };
    expect(sleepScore(night, [usual, usual, usual]).score).toBe(100);
  });

  test("six hours of an eight-hour need, 88% efficient, usual times", () => {
    const night = { onsetMin: 660, wakeMin: 1080, asleepMin: 360, efficiency: 0.88 };
    const result = sleepScore(night, [usual, usual, usual]);
    expect(result.sufficiency).toBe(75);
    expect(result.efficiencyScore).toBeCloseTo(76.7, 1);
    expect(result.consistency).toBeCloseTo(66.7, 1);
    // 0.6 × 75 + 0.2 × 76.7 + 0.2 × 66.7
    expect(result.score).toBeCloseTo(73.7, 1);
  });

  test("without timing history, consistency's weight moves to the rest", () => {
    const night = { onsetMin: 660, wakeMin: 1080, asleepMin: 360, efficiency: 0.88 };
    const result = sleepScore(night, []);
    expect(result.consistency).toBeNull();
    expect(result.score).toBeCloseTo((0.6 * 75 + 0.2 * 76.67) / 0.8, 1);
  });
});
