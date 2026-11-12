import { describe, expect, test } from "bun:test";
import type { MinuteHr } from "../../../src/health/metrics/heart-rate";
import { type RecordedRun, runSpan, withRuns } from "../../../src/health/metrics/runs";
import { MINUTE_MS } from "../../../src/health/metrics/types";
import { walks } from "../../../src/health/metrics/walks";
import { workouts } from "../../../src/health/metrics/workouts";
import { T0 } from "./fixtures";

interface Phase {
  minutes: number;
  bpm: number;
  spm: number;
  motion: number;
}

const REST: Phase = { minutes: 30, bpm: 75, spm: 0, motion: 0.03 };
/** Brisk and uphill: hard enough on HR that the strap joins it to the run. */
const WALK: Phase = { minutes: 15, bpm: 135, spm: 110, motion: 0.3 };
const RUN: Phase = { minutes: 30, bpm: 160, spm: 165, motion: 0.5 };
const PROFILE = { restingHr: 55, maxHr: 205, sex: "male" as const };

/** Minutes from phases, with a quiet half hour first. Returns when each phase starts. */
function day(phases: Phase[]) {
  const minutes: MinuteHr[] = [];
  const steps = new Map<number, number>();
  const motion: { ts: number; intensity: number }[] = [];
  const starts: number[] = [];
  let ts = T0;
  for (const phase of [REST, ...phases, REST]) {
    starts.push(ts);
    for (let i = 0; i < phase.minutes; i++, ts += MINUTE_MS) {
      minutes.push({ ts, bpm: phase.bpm });
      steps.set(ts, phase.spm);
      motion.push({ ts, intensity: phase.motion });
    }
  }
  return { minutes, steps, motion, starts: starts.slice(1) };
}

function run(start: number, minutes: number, distanceMeters = 5100): RecordedRun {
  return { start, end: start + minutes * MINUTE_MS, distanceMeters, stravaId: 42 };
}

/** What the day summary does: workouts with runs put in, then walks around them. */
function activity(d: ReturnType<typeof day>, runs: RecordedRun[]) {
  const found = workouts({ ...d, ...PROFILE, climbs: [], exclude: [] });
  const all = withRuns(found, runs, { ...d, ...PROFILE });
  return { found, all, walks: walks(d.steps, d.minutes, all, runs.map(runSpan)) };
}

describe("withRuns", () => {
  test("walk, run, walk: the strap's one long run becomes a walk, the run and a walk", () => {
    const d = day([WALK, RUN, WALK]);
    const runStart = d.starts[1] as number;

    const { found, all, walks: around } = activity(d, [run(runStart, 30)]);

    // Without Strava, the strap calls the whole hour a run.
    expect(found.map((w) => [w.kind, w.minutes])).toEqual([["running", 60]]);
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({
      kind: "running",
      start: runStart,
      minutes: 30,
      avgHr: 160,
      cadence: 165,
      distanceMeters: 5100,
      stravaId: 42,
    });
    expect(around.map((w) => [w.start, w.minutes])).toEqual([
      [d.starts[0] as number, 15],
      [runStart + 30 * MINUTE_MS, 15],
    ]);
  });

  test("snaps the run to the nearest strap minute", () => {
    const d = day([RUN]);
    const start = (d.starts[0] as number) + 40_000;

    const [workout] = activity(d, [run(start, 30)]).all;

    expect(workout?.start).toBe((d.starts[0] as number) + MINUTE_MS);
    expect(workout?.minutes).toBe(30);
  });

  test("a short walk next to a run counts; the same walk elsewhere doesn't", () => {
    const short = { ...WALK, minutes: 6, bpm: 100 };
    const d = day([RUN, short, REST, short]);

    const { walks: found } = activity(d, [run(d.starts[0] as number, 30)]);

    expect(found.map((w) => [w.start, w.minutes])).toEqual([[d.starts[1] as number, 6]]);
  });

  test("a run with no strap data is still a run, without heart rate", () => {
    const d = day([]);
    const start = T0 + 5 * 60 * MINUTE_MS;

    const { all } = activity(d, [run(start, 30)]);

    expect(all).toEqual([
      expect.objectContaining({ kind: "running", minutes: 30, avgHr: 0, strain: 0 }),
    ]);
  });

  test("workouts the run doesn't touch are kept", () => {
    const volleyball = { minutes: 40, bpm: 160, spm: 50, motion: 0.6 };
    const d = day([RUN, REST, volleyball]);

    const { all } = activity(d, [run(d.starts[0] as number, 30)]);

    expect(all.map((w) => w.kind)).toEqual(["running", "volleyball"]);
  });
});
