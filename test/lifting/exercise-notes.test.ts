import { describe, expect, test } from "bun:test";
import {
  dayMonth,
  fileTitle,
  historyBlock,
  rangeOf,
  readExerciseNote,
  setsText,
  titlesOf,
} from "../../src/lifting/exercise-notes";
import { exerciseHistories } from "../../src/lifting/history";
import { defaultRange, nextTime } from "../../src/lifting/next-time";
import { parseLiftingLog } from "../../src/vault/lifting";

const CHEST = exerciseHistories([
  {
    date: "2026-10-31",
    exercises: parseLiftingLog(
      "## Workouts\n- Chest Press\n  - 60lbs, 1x10, warm-up\n  - 80lbs, 2x10, 1x9\n",
    ),
  },
  {
    date: "2026-11-08",
    exercises: parseLiftingLog(
      "## Workouts\n- Chest Press\n  - 60lbs, 1x10, warm-up\n  - 80lbs, 3x10\n",
    ),
  },
]);

describe("exercise note frontmatter", () => {
  test("reads the title from the file name, aliases, rep range and step", () => {
    const note = readExerciseNote("Lifting/Dumbbell Shoulder Press.md", {
      aliases: ["Dumbell Shoulder Press"],
      reps: "12-15",
      step: 2.5,
    });

    expect(note).toEqual({
      path: "Lifting/Dumbbell Shoulder Press.md",
      title: "Dumbbell Shoulder Press",
      aliases: ["Dumbell Shoulder Press"],
      reps: { low: 12, high: 15 },
      step: 2.5,
    });
    expect(titlesOf([note]).get("dumbell shoulder press")).toBe("Dumbbell Shoulder Press");
  });

  test("a range it can't read falls back to the defaults", () => {
    const note = readExerciseNote("Lifting/Squat.md", { reps: "lots", step: -1 });

    expect(rangeOf(note, "kg")).toEqual(defaultRange("kg"));
    expect(rangeOf(undefined, "lb")).toEqual({ low: 8, high: 12, step: 5 });
  });

  test("file titles drop characters Obsidian won't take", () => {
    expect(fileTitle("Curl / Press: #1")).toBe("Curl  Press 1");
  });
});

describe("the history block", () => {
  const [history] = CHEST;
  if (!history) {
    throw new Error("no history");
  }

  test("next time, records, and every session newest first with HR", () => {
    const next = nextTime(history, defaultRange("lb"), "2026-11-14");

    const block = historyBlock(history, next, (date) =>
      date === "2026-11-08" ? { restSeconds: 125, peakHr: 141 } : null,
    );

    expect(block).toBe(`## History
Next: 60 lb, 1x10 W · 80 lb, 3x11
Records: 80 lb top · est. 1RM 107 · 80 lb, 3x10 on 8 Nov

| Day | Sets | Est. 1RM | Rest | Peak HR | |
| --- | --- | --- | --- | --- | --- |
| [[2026-11-08]] | 60 lb, 1x10 W · 80 lb, 3x10 | 107 | 2:05 | 141 | ↑ reps |
| [[2026-10-31]] | 60 lb, 1x10 W · 80 lb, 2x10, 1x9 | 106 |  |  |  |`);
  });

  test("bodyweight sets have no weight", () => {
    expect(setsText([{ weight: null, reps: 10, warmUp: false }], "lb")).toBe("1x10");
  });

  test("dates read day-month", () => {
    expect(dayMonth("2026-11-08")).toBe("8 Nov");
  });
});
