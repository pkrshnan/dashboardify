import { describe, expect, test } from "bun:test";
import { alignSets, sessionRun } from "../../../src/health/metrics/set-align";
import type { SetClimb } from "../../../src/health/metrics/sets";

/** "14:37" on a fixed day, in ms. */
function at(clock: string): number {
  const [h, m] = clock.split(":").map(Number);
  return Date.UTC(2026, 10, 14, h ?? 0, m ?? 0);
}

/** "14:37+26": a climb of 26 bpm peaking at 14:37. */
function climbs(spec: string): SetClimb[] {
  return spec.split(" ").map((c) => {
    const [clock = "", rise = "0"] = c.split("+");
    return { start: at(clock) - 45_000, peak: at(clock), peakHr: 120, climb: Number(rise) };
  });
}

/** Sets per exercise, in order: [4, 4, 3] is three exercises. */
function sets(perExercise: number[]) {
  return perExercise.flatMap((n, exerciseIndex) =>
    Array.from({ length: n }, () => ({ exerciseIndex })),
  );
}

function times(matched: SetClimb[] | null): string[] | null {
  return matched?.map((c) => new Date(c.peak).toISOString().slice(11, 16)) ?? null;
}

// The climbs around real sessions, as the strap saw them.
const NOV_14 = climbs(
  "14:37+26 14:38+7 14:40+22 14:42+11 14:43+36 14:44+23 14:47+7 14:50+22 14:52+24 14:55+12 " +
    "14:56+8 14:58+12 14:59+23 15:01+22 15:02+14 15:04+19 15:06+35 15:07+30 15:09+22 15:11+9 " +
    "15:12+20 15:16+13 15:18+15 15:20+7 15:22+8 15:25+23 15:27+6 15:29+15 15:30+10 15:32+13",
);
const NOV_9 = climbs(
  "16:43+19 16:44+11 16:46+23 16:47+8 16:48+23 16:51+51 16:53+53 16:55+40 16:56+7 16:58+25 " +
    "17:00+48 17:02+41 17:04+46 17:07+30 17:09+27 17:11+29 17:12+13 17:14+13 17:19+7 17:27+29",
);

describe("the run of climbs around a session", () => {
  test("reaches back for sets the strap trimmed off, but barely past the end", () => {
    // 14 November: the strap found 14:44–15:12; you lifted about 14:35–15:10.
    const run = sessionRun({ start: at("14:44"), end: at("15:12") }, NOV_14);

    expect(times([run[0], run[run.length - 1]] as SetClimb[])).toEqual(["14:37", "15:12"]);
  });

  test("stops where climbs stop coming", () => {
    // 9 November: 17:19 is five minutes after 17:14, so the run ends there.
    const run = sessionRun({ start: at("16:51"), end: at("17:13") }, NOV_9);

    expect(times([run[0], run[run.length - 1]] as SetClimb[])).toEqual(["16:43", "17:14"]);
  });
});

describe("lining sets up with climbs", () => {
  test("14 November: 17 sets across five exercises, inside the time you lifted", () => {
    const run = sessionRun({ start: at("14:44"), end: at("15:12") }, NOV_14);

    const matched = times(alignSets(run, sets([4, 4, 3, 3, 3])));

    expect(matched).toHaveLength(17);
    expect(matched?.[0]).toBe("14:37");
    expect(matched?.[16]).toBe("15:12");
  });

  test("9 November: the warm-up before the strap's session counts, and rests stay steady", () => {
    const run = sessionRun({ start: at("16:51"), end: at("17:13") }, NOV_9);

    expect(times(alignSets(run, sets([4, 4, 3])))).toEqual([
      "16:48",
      "16:51",
      "16:53",
      "16:55",
      "16:58",
      "17:00",
      "17:02",
      "17:04",
      "17:07",
      "17:09",
      "17:11",
    ]);
  });

  test("a small climb between two sets is skipped instead of shifting the rest", () => {
    const run = climbs("10:00+40 10:02+40 10:03+6 10:04+40 10:06+40");

    expect(times(alignSets(run, sets([4])))).toEqual(["10:00", "10:02", "10:04", "10:06"]);
  });

  test("a longer gap is allowed where the exercise changes", () => {
    const run = climbs("10:00+40 10:02+40 10:04+40 10:10+40 10:12+40");

    expect(times(alignSets(run, sets([3, 2])))).toEqual([
      "10:00",
      "10:02",
      "10:04",
      "10:10",
      "10:12",
    ]);
  });

  test("fewer climbs than sets, or a fit that doesn't hold, matches nothing", () => {
    expect(alignSets(climbs("10:00+40 10:02+40"), sets([3]))).toBeNull();
    // Three sets of one exercise, but a minute apart and then half an hour later.
    expect(alignSets(climbs("10:00+40 10:01+40 10:30+40"), sets([3]))).toBeNull();
  });
});
