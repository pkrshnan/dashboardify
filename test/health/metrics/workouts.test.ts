import { describe, expect, test } from "bun:test";
import { stepsPerMinute } from "../../../src/health/metrics/steps";
import { MINUTE_MS } from "../../../src/health/metrics/types";
import { movingInPlace, type WorkoutInput, workouts } from "../../../src/health/metrics/workouts";
import { T0 } from "./fixtures";

interface Phase {
  minutes: number;
  bpm: number;
  spm: number;
  motion: number;
  /** A big HR climb peaks in the phase's last minute, like the end of a set. */
  climb?: boolean;
}

const REST: Phase = { minutes: 30, bpm: 75, spm: 0, motion: 0.03 };

/** A day built from phases, one value per minute each, with a quiet half hour either side. */
function day(phases: Phase[], overrides: Partial<WorkoutInput> = {}): WorkoutInput {
  const input: WorkoutInput = {
    minutes: [],
    climbs: [],
    steps: new Map(),
    motion: [],
    restingHr: 55,
    maxHr: 205,
    sex: "male",
    exclude: [],
    ...overrides,
  };
  let ts = T0;
  for (const phase of [REST, ...phases, REST]) {
    for (let i = 0; i < phase.minutes; i++, ts += MINUTE_MS) {
      input.minutes.push({ ts, bpm: phase.bpm });
      input.steps.set(ts, phase.spm);
      input.motion.push({ ts, intensity: phase.motion });
      if (phase.climb && i === phase.minutes - 1) {
        input.climbs.push({ start: ts - 40_000, peak: ts + 30_000, peakHr: phase.bpm, climb: 30 });
      }
    }
  }
  return input;
}

/** Hard play broken by breaks between games. */
const volleyball: Phase[] = Array.from({ length: 4 }, () => [
  { minutes: 10, bpm: 160, spm: 50, motion: 0.6 },
  { minutes: 4, bpm: 120, spm: 0, motion: 0.1 },
]).flat();

/**
 * Sets and rests in place. HR never gets near a cardio workout's level, but it spikes each set and
 * calms after, like the real session on 8 November.
 */
const lifting: Phase[] = Array.from({ length: 10 }, () => [
  { minutes: 2, bpm: 100, spm: 2, motion: 0.15, climb: true },
  { minutes: 3, bpm: 88, spm: 0, motion: 0.08 },
]).flat();

describe("workouts", () => {
  test("a steady run is running", () => {
    const found = workouts(day([{ minutes: 40, bpm: 160, spm: 165, motion: 0.5 }]));

    expect(found).toHaveLength(1);
    expect(found[0]).toMatchObject({ kind: "running", minutes: 40, avgHr: 160, cadence: 165 });
    expect(found[0]?.strain).toBeGreaterThan(5);
  });

  test("a hard uphill walk is walking, not volleyball", () => {
    const found = workouts(day([{ minutes: 40, bpm: 140, spm: 120, motion: 0.3 }]));

    expect(found.map((w) => w.kind)).toEqual(["walking"]);
  });

  test("bursts of play with breaks are one volleyball session", () => {
    const found = workouts(day(volleyball));

    expect(found).toHaveLength(1);
    expect(found[0]?.kind).toBe("volleyball");
    // The last break is above the active line but has no effort in it, so it is trimmed off.
    expect(found[0]?.minutes).toBe(52);
  });

  test("a warm-up walk and the slow recovery afterwards are trimmed off", () => {
    const warmUp = { minutes: 5, bpm: 108, spm: 120, motion: 0.28 };
    const recovery = { minutes: 12, bpm: 115, spm: 40, motion: 0.1 };

    const [found] = workouts(day([warmUp, ...volleyball.slice(0, -1), recovery]));

    expect(found?.kind).toBe("volleyball");
    expect(found?.start).toBe(T0 + (30 + 5) * MINUTE_MS);
    expect(found?.minutes).toBe(52);
  });

  test("sets and rests in place are lifting, from the spikes and calms, at a low HR", () => {
    const found = workouts(day(lifting));

    expect(found.map((w) => w.kind)).toEqual(["lifting"]);
    // From the first set's spike to the last's.
    expect(found[0]?.minutes).toBe(46);
  });

  test("hard lifting starts at its warm-up set, though that set wasn't hard", () => {
    // Like 9 November: a warm-up set under half of reserve, then sets that went over it.
    const warmUp: Phase[] = [
      { minutes: 2, bpm: 120, spm: 2, motion: 0.15, climb: true },
      { minutes: 3, bpm: 105, spm: 0, motion: 0.1 },
    ];
    const hardSets = lifting.map((p) => ({ ...p, bpm: p.climb ? 140 : 110 }));

    const [found] = workouts(day([...warmUp, ...hardSets]));

    expect(found?.kind).toBe("lifting");
    expect(found?.start).toBe(T0 + (30 + 1) * MINUTE_MS);
    expect(found?.minutes).toBe(51);

    // A climb well after the last set, still sweaty, is standing up, not a set.
    const after: Phase[] = [
      { minutes: 10, bpm: 100, spm: 0, motion: 0.05 },
      { minutes: 1, bpm: 110, spm: 0, motion: 0.1, climb: true },
    ];
    const [walkedOff] = workouts(day([...warmUp, ...hardSets, ...after]));

    expect(walkedOff?.minutes).toBe(51);
  });

  test("the same moving about without the spikes is not a workout", () => {
    const input = day(lifting);
    input.climbs = [];

    expect(workouts(input)).toEqual([]);
  });

  test("a few spikes are not a session", () => {
    const input = day(lifting.slice(0, 8));

    expect(workouts(input)).toEqual([]);
  });

  test("a spike in the warm-up doesn't stretch a hard workout", () => {
    const warmUp = { minutes: 8, bpm: 100, spm: 10, motion: 0.15, climb: true };

    const [found] = workouts(day([warmUp, ...volleyball]));

    expect(found?.kind).toBe("volleyball");
    expect(found?.start).toBe(T0 + (30 + 8) * MINUTE_MS);
  });

  test("a rest over 5 minutes splits two workouts", () => {
    const run = { minutes: 20, bpm: 160, spm: 165, motion: 0.5 };
    const found = workouts(day([run, { minutes: 8, bpm: 80, spm: 0, motion: 0.03 }, run]));

    expect(found).toHaveLength(2);
  });

  test("short, easy or motionless efforts are not workouts", () => {
    const short = day([{ minutes: 10, bpm: 160, spm: 165, motion: 0.5 }]);
    const easy = day([{ minutes: 60, bpm: 115, spm: 60, motion: 0.2 }]);
    const glitch = day([{ minutes: 30, bpm: 150, spm: 0, motion: 0.006 }]);

    expect(workouts(short)).toEqual([]);
    expect(workouts(easy)).toEqual([]);
    expect(workouts(glitch)).toEqual([]);
  });

  test("nothing counts during sleep", () => {
    const input = day(lifting);
    input.exclude = [{ start: T0, end: T0 + 24 * 60 * MINUTE_MS }];

    expect(workouts(input)).toEqual([]);
  });

  test("steps per minute come from the raw counter", () => {
    const counts = [100, 102, 105, 65_535, 4].map((count, i) => ({ ts: T0 + i * 20_000, count }));

    // +2 and +3 in the first minute; the jump to 65,535 is too fast to be real, so it is dropped;
    // the wrap to 4 adds 5 in the second minute.
    expect([...stepsPerMinute(counts)]).toEqual([
      [T0, 5],
      [T0 + MINUTE_MS, 5],
    ]);
  });
});

describe("moving in place", () => {
  test("finds a lifting session that never lifted HR, and skips walks and stillness", () => {
    const input = day([
      { minutes: 20, bpm: 100, spm: 110, motion: 0.2 },
      { minutes: 10, bpm: 70, spm: 0, motion: 0.01 },
      { minutes: 40, bpm: 95, spm: 2, motion: 0.15 },
    ]);

    const span = movingInPlace(input.motion, input.steps, []);

    expect(span).toEqual({ start: T0 + 60 * MINUTE_MS, end: T0 + 100 * MINUTE_MS });
  });

  test("under 15 minutes, or excluded, is nothing", () => {
    const short = day([{ minutes: 10, bpm: 95, spm: 0, motion: 0.15 }]);
    const long = day([{ minutes: 40, bpm: 95, spm: 0, motion: 0.15 }]);

    expect(movingInPlace(short.motion, short.steps, [])).toBeNull();
    expect(
      movingInPlace(long.motion, long.steps, [{ start: T0, end: T0 + 200 * MINUTE_MS }]),
    ).toBeNull();
  });
});
