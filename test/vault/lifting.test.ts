import { describe, expect, test } from "bun:test";
import { loggedSets, parseLiftingLog } from "../../src/vault/lifting";

// Exactly as written in a real daily note.
const NOTE = `# 2026-11-08

## Workouts
- Chest Press
    - 60lbs, 1x10, warm-up
    - 80lbs, 3x10
- Cable Fly Crossovers
    - 7.5 lbs, 1x10
    - 12.5lbs, 3x10
- Tricep Pushdown
    - 22.5lbs, 1x10
    - 32.5lbs, 3x10

## Journal
- 09:00 Not an exercise.
`;

describe("lifting log", () => {
  test("reads exercises and loads in order", () => {
    const log = parseLiftingLog(NOTE);

    expect(log.map((e) => e.name)).toEqual([
      "Chest Press",
      "Cable Fly Crossovers",
      "Tricep Pushdown",
    ]);
    expect(log[1]?.lines).toEqual([
      { weight: 7.5, unit: "lb", sets: 1, reps: 10, warmUp: false },
      { weight: 12.5, unit: "lb", sets: 3, reps: 10, warmUp: false },
    ]);
    expect(log[0]?.lines[0]).toMatchObject({ weight: 60, sets: 1, warmUp: true });
  });

  test("expands sets; only a line tagged warm-up is a warm-up", () => {
    const sets = loggedSets(parseLiftingLog(NOTE));

    expect(sets).toHaveLength(12);
    // Chest Press tags its lighter first line; Cable Fly's lighter first line is untagged.
    expect(sets.filter((s) => s.warmUp).map((s) => [s.exercise, s.weight])).toEqual([
      ["Chest Press", 60],
    ]);
    expect(sets[4]).toMatchObject({
      exercise: "Cable Fly Crossovers",
      exerciseIndex: 1,
      weight: 7.5,
      warmUp: false,
    });
  });

  test("reads warm-up after the weight or the sets, in any case", () => {
    const log = parseLiftingLog(
      "## Workouts\n- Squat\n  - 20kg, 1x10 warmup\n  - 1x8, 30kg, Warm-up\n  - 40kg, 3x5\n",
    );

    expect(log[0]?.lines.map((l) => l.warmUp)).toEqual([true, true, false]);
  });

  test("accepts kg, ×, spaces and bodyweight, and skips notes", () => {
    const log = parseLiftingLog(
      "## Workouts\n- Squat\n  - 40kg, 3 × 8\n  - felt heavy\n- Pull-ups\n  - 3x12\n- Stretching\n",
    );

    expect(log).toEqual([
      { name: "Squat", lines: [{ weight: 40, unit: "kg", sets: 3, reps: 8, warmUp: false }] },
      { name: "Pull-ups", lines: [{ weight: null, unit: null, sets: 3, reps: 12, warmUp: false }] },
    ]);
    expect(loggedSets(log).some((s) => s.warmUp)).toBe(false);
  });

  test("one weight can carry several sets×reps groups", () => {
    const log = parseLiftingLog("## Workouts\n- Dumbell Shoulder Press\n    - 15lbs, 2x10, 1x8\n");

    expect(log[0]?.lines).toEqual([
      { weight: 15, unit: "lb", sets: 2, reps: 10, warmUp: false },
      { weight: 15, unit: "lb", sets: 1, reps: 8, warmUp: false },
    ]);
    expect(loggedSets(log).map((s) => [s.reps, s.warmUp])).toEqual([
      [10, false],
      [10, false],
      [8, false],
    ]);
  });

  test("the weight can come after the sets×reps", () => {
    const log = parseLiftingLog(
      "## Workouts\n* Lat Pulldown\n    * 1x10, 55lbs\n    * 2x9, 75lbs\n",
    );

    expect(log[0]?.lines).toEqual([
      { weight: 55, unit: "lb", sets: 1, reps: 10, warmUp: false },
      { weight: 75, unit: "lb", sets: 2, reps: 9, warmUp: false },
    ]);
  });

  test("no Workouts section, no log", () => {
    expect(parseLiftingLog("## Journal\n- Chest Press\n  - 60lbs, 1x10\n")).toEqual([]);
  });
});
