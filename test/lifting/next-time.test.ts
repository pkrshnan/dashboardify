import { describe, expect, test } from "bun:test";
import { type DayLog, exerciseHistories } from "../../src/lifting/history";
import { defaultRange, nextTime } from "../../src/lifting/next-time";
import { parseLiftingLog } from "../../src/vault/lifting";

function history(...logs: [string, string][]) {
  const days: DayLog[] = logs.map(([date, lines]) => ({
    date,
    exercises: parseLiftingLog(`## Workouts\n- Lift\n${lines}`),
  }));
  const [found] = exerciseHistories(days);
  if (!found) {
    throw new Error("no history");
  }
  return found;
}

/** "80 lb, 3x11" style, warm-ups marked W. */
function written(sets: { weight: number | null; reps: number; warmUp: boolean }[]): string[] {
  return sets.map((s) => `${s.warmUp ? "W " : ""}${s.weight ?? "bw"}x${s.reps}`);
}

const RANGE = defaultRange("lb");

describe("next time", () => {
  test("under the top of the range: one more rep each set, warm-up kept", () => {
    const next = nextTime(
      history(["2026-11-08", "  - 60lbs, 1x10, warm-up\n  - 80lbs, 3x10\n"]),
      RANGE,
      "2026-11-14",
    );

    expect(next?.reason).toBe("more-reps");
    expect(written(next?.sets ?? [])).toEqual(["W 60x10", "80x11", "80x11", "80x11"]);
  });

  test("uneven sets each gain a rep, capped at the top", () => {
    const next = nextTime(
      history(["2026-11-09", "  - 75lbs, 1x12, 1x11, 1x9\n"]),
      RANGE,
      "2026-11-14",
    );

    expect(written(next?.sets ?? [])).toEqual(["75x12", "75x12", "75x10"]);
  });

  test("every set at the top: add the step and go back to the bottom", () => {
    const calves = { low: 12, high: 15, step: 5 };

    const next = nextTime(history(["2026-11-12", "  - 60lbs, 3x15\n"]), calves, "2026-11-14");

    expect(next?.reason).toBe("add-weight");
    expect(written(next?.sets ?? [])).toEqual(["65x12", "65x12", "65x12"]);
  });

  test("three sessions at a weight without more reps: down a step", () => {
    const stuck = history(
      ["2026-10-26", "  - 75lbs, 2x9, 1x8\n"],
      ["2026-11-02", "  - 75lbs, 1x9, 2x8\n"],
      ["2026-11-09", "  - 75lbs, 2x9, 1x8\n"],
    );

    const next = nextTime(stuck, RANGE, "2026-11-14");

    expect(next?.reason).toBe("stuck");
    expect(written(next?.sets ?? [])).toEqual(["70x8", "70x8", "70x8"]);
  });

  test("reps still rising at a weight isn't a stall", () => {
    const rising = history(
      ["2026-10-26", "  - 75lbs, 3x8\n"],
      ["2026-11-02", "  - 75lbs, 3x8\n"],
      ["2026-11-09", "  - 75lbs, 3x9\n"],
    );

    expect(nextTime(rising, RANGE, "2026-11-14")?.reason).toBe("more-reps");
  });

  test("after more than three weeks off: repeat the last session", () => {
    const next = nextTime(history(["2026-10-01", "  - 75lbs, 1x9, 2x8\n"]), RANGE, "2026-11-14");

    expect(next?.reason).toBe("break");
    expect(written(next?.sets ?? [])).toEqual(["75x9", "75x8", "75x8"]);
  });

  test("bodyweight: one more rep each set", () => {
    const next = nextTime(history(["2026-11-08", "  - 1x9, 2x8\n"]), RANGE, "2026-11-14");

    expect(written(next?.sets ?? [])).toEqual(["bwx10", "bwx9", "bwx9"]);
  });

  test("kg steps by 2.5", () => {
    expect(defaultRange("kg")).toEqual({ low: 8, high: 12, step: 2.5 });
  });
});
