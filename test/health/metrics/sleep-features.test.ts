import { describe, expect, test } from "bun:test";
import { type CleanBeat, cleanRr } from "../../../src/health/metrics/hrv";
import type { AngleChange } from "../../../src/health/metrics/sleep";
import { EPOCH_MS, scoreEpochs, sleepTimes } from "../../../src/health/metrics/sleep-epochs";
import {
  continuityBreaks,
  type EpochFeatures,
  epochBreathing,
  epochDfa,
  epochFeatures,
  zScores,
} from "../../../src/health/metrics/sleep-features";
import { mean } from "../../../src/health/metrics/stats";
import type { HeartRate, RrInterval } from "../../../src/health/metrics/types";
import {
  breathingBeats,
  HOUR,
  heartRate,
  pinkNoise,
  random,
  seriesBeats,
  T0,
  whiteNoise,
} from "./fixtures";

const window = { start: T0, end: T0 + 2 * HOUR };
const half = T0 + HOUR;

// First hour deep-like: HR 58, big regular swings with breathing (high RMSSD). Second hour
// REM-like: HR 63 that jumps about, small swings (low RMSSD). 63 stays under the awake line
// (20% over the night's sleeping level), so both hours score asleep.
const deepBeats = breathingBeats(T0, HOUR, { base: 1035, swing: 60, noise: 4 });
const remBeats = breathingBeats(half, HOUR, { base: 950, swing: 4, noise: 6 });
const jumpy = random(5);
const hr = heartRate(window.start, window.end, (ts) =>
  ts < half ? 58 : 63 + Math.round((jumpy() - 0.5) * 6),
);

function features(
  beats: RrInterval[],
  heart: HeartRate[] = hr,
  changes: AngleChange[] = [],
): EpochFeatures[] {
  const epochs = scoreEpochs(window, changes, heart);
  return epochFeatures({
    window,
    epochs,
    onset: sleepTimes(window, epochs).onset,
    changes,
    heartRate: heart,
    beats: cleanRr(beats),
  });
}

/** The mean of a feature over the epochs that have it, from `from` to `to`. */
function average(
  rows: EpochFeatures[],
  key: "hrZ" | "hrvZ" | "breathingZ" | "dfaZ",
  from: number,
  to: number,
): number {
  const values = rows
    .filter((r) => r.ts >= from && r.ts < to)
    .map((r) => r[key])
    .filter((v): v is number => v !== null);
  return mean(values) ?? Number.NaN;
}

/** Beats with no breathing rhythm: each gap 1000 ms ± 80 ms at random. */
function noisyBeats(start: number, durationMs: number): RrInterval[] {
  const rand = random(11);
  const beats: RrInterval[] = [];
  let t = start;
  while (t < start + durationMs) {
    const ms = Math.round(1000 + (rand() - 0.5) * 160);
    t += ms;
    beats.push({ ts: t, ms });
  }
  return beats;
}

describe("epoch features", () => {
  test("line up with scoreEpochs and carry its awake epochs through", () => {
    // Two epochs, so rescoring doesn't treat it as a lone flicker.
    const changes = [
      { ts: T0 + 30 * 60_000 + 5_000, change: 20 },
      { ts: T0 + 30 * 60_000 + 35_000, change: 8 },
    ];

    const rows = features([...deepBeats, ...remBeats], hr, changes);
    const epochs = scoreEpochs(window, changes, hr);

    expect(rows).toHaveLength(240);
    expect(rows.map((r) => r.ts)).toEqual(epochs.map((e) => e.ts));
    expect(rows.map((r) => r.asleep)).toEqual(epochs.map((e) => e.asleep));
    expect(rows[60]).toMatchObject({ asleep: false, movementDeg: 20 });
    expect(rows[61]).toMatchObject({ asleep: false, movementDeg: 8 });
    expect(rows[0]).toMatchObject({ movementDeg: 0, sinceOnsetMin: 0 });
    expect(rows[120]?.sinceOnsetMin).toBe(60);
  });

  test("a low, steady HR with high RMSSD scores deep-like; the other way scores REM-like", () => {
    const rows = features([...deepBeats, ...remBeats]);

    // Leave out the 5 minutes either side of the switch, where windows straddle both.
    const deep = { hr: average(rows, "hrZ", T0, half - 5 * 60_000) };
    const rem = { hr: average(rows, "hrZ", half + 5 * 60_000, window.end) };
    const deepHrv = average(rows, "hrvZ", T0 + 5 * 60_000, half - 5 * 60_000);
    const remHrv = average(rows, "hrvZ", half + 5 * 60_000, window.end - 5 * 60_000);

    expect(rows.every((r) => r.asleep)).toBe(true);
    expect(deep.hr).toBeLessThan(-0.5);
    expect(rem.hr).toBeGreaterThan(0.5);
    expect(deepHrv).toBeGreaterThan(0.5);
    expect(remHrv).toBeLessThan(-0.5);
  });

  test("regular breathing scores more regular than noise", () => {
    const regular = cleanRr(breathingBeats(T0, HOUR, { swing: 40, breathsPerMin: 15 }));
    const noise = cleanRr(noisyBeats(half, HOUR));
    const beats: CleanBeat[] = [...regular, ...noise];
    const centres = Array.from({ length: 240 }, (_, i) => T0 + i * EPOCH_MS + EPOCH_MS / 2);

    const sharpness = epochBreathing(beats, centres);
    const first = sharpness.slice(4, 116).filter((v): v is number => v !== null);
    const second = sharpness.slice(124, 236).filter((v): v is number => v !== null);

    expect(first).toHaveLength(112);
    expect(second).toHaveLength(112);
    expect(Math.min(...first)).toBeGreaterThan(Math.max(...second));
    const rows = features(beats.map(({ ts, ms }) => ({ ts, ms })));
    expect(average(rows, "breathingZ", T0, half - 2 * 60_000)).toBeGreaterThan(
      average(rows, "breathingZ", half + 2 * 60_000, window.end),
    );
  });

  test("gaps in the beats or HR give nulls", () => {
    const gap = { start: T0 + 40 * 60_000, end: T0 + 60 * 60_000 };
    const beats = [...deepBeats, ...remBeats].filter((b) => b.ts < gap.start || b.ts >= gap.end);
    const heart = hr.filter((h) => h.ts < gap.start || h.ts >= gap.end);

    const rows = features(beats, heart);
    const middle = rows[100];

    expect(middle).toMatchObject({
      hrZ: null,
      hrvZ: null,
      breathingZ: null,
      dfaZ: null,
      asleep: false,
    });
    expect(rows[20]?.hrvZ).not.toBeNull();
    expect(rows[20]?.breathingZ).not.toBeNull();
    expect(rows[20]?.dfaZ).not.toBeNull();
  });

  test("with no beats at all, every beat feature is null", () => {
    const rows = features([]);

    expect(rows.every((r) => r.hrvZ === null && r.breathingZ === null && r.dfaZ === null)).toBe(
      true,
    );
    expect(rows.every((r) => r.hrZ !== null)).toBe(true);
  });
});

/** The beats with each beat at `at` missed: its gap is merged into the next one. */
function missedBeats(beats: RrInterval[], at: number[]): RrInterval[] {
  return beats.flatMap((b, i) => {
    if (at.includes(i)) {
      return [];
    }
    const missed = at.includes(i - 1) ? (beats[i - 1]?.ms ?? 0) : 0;
    return [{ ts: b.ts, ms: b.ms + missed }];
  });
}

describe("DFA α1 per epoch", () => {
  // First hour uncorrelated (deep-like, α1 about 0.5), second hour 1/f (REM-like, about 1.0).
  const white = seriesBeats(T0, whiteNoise(3_600, 3), 1000, 20);
  const last = white[white.length - 1]?.ts ?? T0;
  const pink = seriesBeats(last, pinkNoise(3_600, 3), 1000, 20);
  const beats = cleanRr([...white, ...pink]);
  const centres = Array.from({ length: 240 }, (_, i) => T0 + i * EPOCH_MS + EPOCH_MS / 2);

  test("tells uncorrelated beats from 1/f ones, raw and as a z-score", () => {
    const alpha = epochDfa(beats, centres);
    const first = mean(alpha.slice(10, 110).filter((v): v is number => v !== null)) ?? 0;
    const second = mean(alpha.slice(130, 230).filter((v): v is number => v !== null)) ?? 0;
    const rows = features(beats.map(({ ts, ms }) => ({ ts, ms })));

    expect(first).toBeGreaterThan(0.4);
    expect(first).toBeLessThan(0.7);
    expect(second).toBeGreaterThan(0.85);
    expect(average(rows, "dfaZ", T0 + 5 * 60_000, half - 5 * 60_000)).toBeLessThan(-0.5);
    expect(average(rows, "dfaZ", half + 5 * 60_000, window.end - 5 * 60_000)).toBeGreaterThan(0.5);
  });

  test("a lone dropped gap is bridged; two in a row end the run", () => {
    // A missed beat merges two gaps into one about twice as long, which cleaning drops.
    const beats = seriesBeats(T0, whiteNoise(160, 4));
    const one = missedBeats(beats, [75]);
    const two = missedBeats(beats, [75, 77]);
    const centre = [T0 + 80_000];

    expect(epochDfa(cleanRr(one), centre)[0]).not.toBeNull();
    expect(epochDfa(cleanRr(one), centre, 0)[0]).toBeNull();
    expect(epochDfa(cleanRr(two), centre)[0]).toBeNull();
  });

  test("a missing stretch breaks the beats; stamps rounded up to the second and gaps 2.4% short don't", () => {
    const beats = seriesBeats(T0, whiteNoise(400, 5));
    const stamped = beats.map((b) => ({ ts: Math.ceil(b.ts / 1000) * 1000, ms: b.ms / 1.024 }));
    const missing = stamped.filter((_, i) => i < 200 || i >= 205);

    expect(continuityBreaks(stamped).some((b) => b)).toBe(false);
    expect(continuityBreaks(missing).flatMap((b, i) => (b ? [i] : []))).toEqual([200]);
  });
});

describe("z-scores", () => {
  test("are against the asleep values only", () => {
    const z = zScores([1, 3, 100, null], [true, true, false, true]);

    expect(z[0]).toBeCloseTo(-Math.SQRT1_2, 9);
    expect(z[1]).toBeCloseTo(Math.SQRT1_2, 9);
    expect(z[2]).toBeCloseTo(98 / Math.SQRT2, 9);
    expect(z[3]).toBeNull();
  });

  test("are null when the night doesn't vary", () => {
    expect(zScores([2, 2, 2], [true, true, true])).toEqual([null, null, null]);
  });
});
