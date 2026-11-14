import { describe, expect, test } from "bun:test";
import { type DayLog, exerciseHistories } from "../../src/lifting/history";
import { parseLiftingLog } from "../../src/vault/lifting";

function day(date: string, log: string): DayLog {
  return { date, exercises: parseLiftingLog(`## Workouts\n${log}`) };
}

// The real logs of 8, 9 and 12 November.
const REAL = [
  day(
    "2026-11-08",
    "- Chest Press\n    - 60lbs, 1x10\n    - 80lbs, 3x10\n- Dumbell Shoulder Press\n    - 15lbs, 2x10, 1x8\n",
  ),
  day("2026-11-09", "* Lat Pulldown\n    * 1x10, 55lbs\n    * 2x9, 75lbs\n    * 1x8, 75lbs\n"),
  day("2026-11-12", "- Leg Press\n    - 120lbs, 1x10\n    - 180lbs, 1x10\n    - 200lbs, 3x10\n"),
];

/** Chest Press at 80 lb, the reps climbing, as on the boards. */
function chestPress(reps: number[][]): DayLog[] {
  return reps.map((r, i) =>
    day(
      new Date(Date.UTC(2026, 9, 10 + i * 7)).toISOString().slice(0, 10),
      `- Chest Press\n    - 60lbs, 1x10, warm-up\n${r.map((n) => `    - 80lbs, 1x${n}`).join("\n")}\n`,
    ),
  );
}

describe("exercise histories", () => {
  test("the top weight and the reps at it, whatever came before", () => {
    const [legPress, latPulldown] = exerciseHistories(REAL);

    expect(legPress?.title).toBe("Leg Press");
    expect(legPress?.sessions[0]).toMatchObject({ topWeight: 200, repsAtTop: [10, 10, 10] });
    expect(latPulldown?.sessions[0]).toMatchObject({ topWeight: 75, repsAtTop: [9, 9, 8] });
  });

  test("most recent first, and a weight shared by several groups", () => {
    const histories = exerciseHistories(REAL);

    expect(histories.map((h) => h.title)).toEqual([
      "Leg Press",
      "Lat Pulldown",
      "Chest Press",
      "Dumbell Shoulder Press",
    ]);
    expect(histories[3]?.sessions[0]?.repsAtTop).toEqual([10, 10, 8]);
  });

  test("est. 1RM uses the average set at the top weight, so 3x10 beats 10, 9, 8", () => {
    const [press] = exerciseHistories(
      chestPress([
        [9, 8, 8],
        [10, 9, 8],
        [10, 9, 9],
        [10, 10, 9],
        [10, 10, 10],
      ]),
    );

    expect(press?.sessions.map((s) => Math.round(s.est1rm ?? 0))).toEqual([
      102, 104, 105, 106, 107,
    ]);
    expect(press?.records.est1rm?.date).toBe("2026-11-07");
    expect(press?.records.atTop).toEqual({ value: [10, 10, 10], date: "2026-11-07" });
  });

  test("tagged warm-ups stay out of the top weight and the volume", () => {
    const [press] = exerciseHistories(chestPress([[10, 10, 10]]));

    expect(press?.sessions[0]?.sets[0]).toEqual({ weight: 60, reps: 10, warmUp: true });
    expect(press?.sessions[0]?.volume).toBe(2400);
  });

  test("progress: heavier, then more reps at it, then the same, then fewer", () => {
    const [press] = exerciseHistories([
      day("2026-10-01", "- Chest Press\n  - 75lbs, 3x12\n"),
      day("2026-10-08", "- Chest Press\n  - 80lbs, 3x8\n"),
      day("2026-10-15", "- Chest Press\n  - 80lbs, 2x9, 1x8\n"),
      day("2026-10-22", "- Chest Press\n  - 80lbs, 1x9, 1x8, 1x9\n"),
      day("2026-10-29", "- Chest Press\n  - 80lbs, 3x8\n"),
      day("2026-11-05", "- Chest Press\n  - 75lbs, 3x10\n"),
    ]);

    expect(press?.sessions.map((s) => s.progress)).toEqual([
      null,
      "weight",
      "reps",
      "same",
      "down",
      "down",
    ]);
    expect(press?.records.heaviest).toEqual({ value: 80, date: "2026-10-08" });
    expect(press?.records.atTop).toEqual({ value: [12, 12, 12], date: "2026-10-01" });
  });

  test("names that differ only in case or a plural are one exercise; titles can rename", () => {
    const days = [
      day("2026-11-01", "- Cable Fly Crossovers\n  - 12.5lbs, 3x10\n"),
      day("2026-11-08", "- cable fly crossover\n  - 12.5lbs, 3x11\n"),
      day("2026-11-09", "- Dumbell Shoulder Press\n  - 15lbs, 3x10\n"),
    ];

    const histories = exerciseHistories(
      days,
      new Map([["dumbell shoulder press", "Dumbbell Shoulder Press"]]),
    );

    expect(histories.map((h) => [h.title, h.sessions.length])).toEqual([
      ["Dumbbell Shoulder Press", 1],
      ["Cable Fly Crossovers", 2],
    ]);
  });

  test("the same exercise twice in a day is one session", () => {
    const squat = exerciseHistories([
      day("2026-11-01", "- Squat\n  - 40kg, 2x5\n- Row\n  - 30kg, 3x8\n- Squat\n  - 40kg, 1x5\n"),
    ]).find((h) => h.title === "Squat");

    expect(squat?.sessions).toHaveLength(1);
    expect(squat?.sessions[0]?.repsAtTop).toEqual([5, 5, 5]);
  });

  test("bodyweight has no top weight; progress is in reps", () => {
    const [pullUp] = exerciseHistories([
      day("2026-11-01", "- Pull-ups\n  - 1x9, 2x8\n"),
      day("2026-11-08", "- Pull-up\n  - 1x10, 2x9\n"),
    ]);

    expect(pullUp?.sessions[1]).toMatchObject({
      topWeight: null,
      est1rm: null,
      repsAtTop: [10, 9, 9],
      progress: "reps",
    });
    expect(pullUp?.records.heaviest).toBeNull();
  });

  test("an exercise logged in both units is shown in its latest", () => {
    const [squat] = exerciseHistories([
      day("2026-11-01", "- Squat\n  - 132.3lbs, 3x5\n"),
      day("2026-11-08", "- Squat\n  - 60kg, 3x5\n"),
    ]);

    expect(squat?.unit).toBe("kg");
    expect(squat?.sessions[0]?.topWeight).toBeCloseTo(60, 1);
    expect(squat?.sessions[1]?.progress).toBe("same");
  });
});
