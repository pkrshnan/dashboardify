import { describe, expect, test } from "bun:test";
import type { WorkSet } from "../../src/lifting/history";
import { loadLines, removeExercise, replaceExercise } from "../../src/lifting/log-edit";
import { parseLiftingLog } from "../../src/vault/lifting";

function sets(...spec: [number | null, number, boolean?][]): WorkSet[] {
  return spec.map(([weight, reps, warmUp]) => ({ weight, reps, warmUp: warmUp ?? false }));
}

// Exactly as written on 9 November: `*` bullets, four-space indent, weight last.
const NOV_9 = `# 2026-11-09

## Workouts

* Lat Pulldown
    * 1x10, 55lbs
    * 2x9, 75lbs
    * felt strong
* Seated Row
    * 1x10, 55lbs
## Journal
- 09:00 Gym later.
`;

describe("load lines", () => {
  test("sets at one weight share a line; the weight comes first", () => {
    expect(loadLines(sets([80, 11], [80, 11], [80, 10]), "lb")).toEqual(["80lbs, 2x11, 1x10"]);
  });

  test("a warm-up is its own line, tagged", () => {
    expect(loadLines(sets([7.5, 10, true], [12.5, 11], [12.5, 11]), "lb")).toEqual([
      "7.5lbs, 1x10, warm-up",
      "12.5lbs, 2x11",
    ]);
  });

  test("kg and bodyweight", () => {
    expect(loadLines(sets([40, 8], [40, 8]), "kg")).toEqual(["40kg, 2x8"]);
    expect(loadLines(sets([null, 10], [null, 9]), "lb")).toEqual(["1x10, 1x9"]);
  });

  test("what's written reads back as the same sets", () => {
    const written = sets([60, 10, true], [80, 11], [80, 11], [80, 10]);
    const body = replaceExercise("", "Chest Press", "lb", written);

    const [chest] = parseLiftingLog(body);

    expect(chest?.lines).toEqual([
      { weight: 60, unit: "lb", sets: 1, reps: 10, warmUp: true },
      { weight: 80, unit: "lb", sets: 2, reps: 11, warmUp: false },
      { weight: 80, unit: "lb", sets: 1, reps: 10, warmUp: false },
    ]);
  });
});

describe("replacing an exercise", () => {
  test("rewrites only its load lines, keeping its note and everything else", () => {
    const body = replaceExercise(NOV_9, "lat pulldowns", "lb", sets([75, 10], [75, 10], [75, 9]));

    expect(body).toBe(`# 2026-11-09

## Workouts

* Lat Pulldown
    * 75lbs, 2x10, 1x9
    * felt strong
* Seated Row
    * 1x10, 55lbs
## Journal
- 09:00 Gym later.
`);
  });

  test("a new exercise goes at the end of the section in the section's style", () => {
    const body = replaceExercise(NOV_9, "Cable Bicep Curl", "lb", sets([22.5, 10], [22.5, 10]));

    expect(body).toContain(
      "* Seated Row\n    * 1x10, 55lbs\n* Cable Bicep Curl\n    * 22.5lbs, 2x10\n## Journal",
    );
  });

  test("a note without the section gets one before Journal", () => {
    const body = replaceExercise(
      "# 2026-11-14\n\n## Journal\n",
      "Leg Press",
      "lb",
      sets([200, 10]),
    );

    expect(body).toBe(
      "# 2026-11-14\n\n## Workouts\n- Leg Press\n    - 200lbs, 1x10\n\n## Journal\n",
    );
  });

  test("an empty note gets the section", () => {
    expect(replaceExercise("", "Squat", "kg", sets([40, 5]))).toBe(
      "## Workouts\n- Squat\n    - 40kg, 1x5\n",
    );
  });
});

describe("removing an exercise", () => {
  test("takes it and its indented lines out", () => {
    const body = removeExercise(NOV_9, "Lat Pulldown");

    expect(body).toContain("## Workouts\n\n* Seated Row\n    * 1x10, 55lbs\n## Journal");
    expect(body).not.toContain("felt strong");
  });

  test("leaves the note alone when the exercise isn't there", () => {
    expect(removeExercise(NOV_9, "Squat")).toBe(NOV_9);
  });
});
