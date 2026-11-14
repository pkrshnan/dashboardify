import { describe, expect, test } from "bun:test";
import type { ExerciseView } from "../../web/api";
import {
  addChoices,
  addSet,
  newDraft,
  setLabels,
  setWeight,
  stepReps,
  stepWeight,
  toggleWarmUp,
  toSave,
  usuallyNext,
} from "../../web/lib/workout-log";

const W = (weight: number | null, reps: number, warmUp = false) => ({ weight, reps, warmUp });

function exercise(title: string, date: string, next = [W(80, 11)]): ExerciseView {
  return {
    slug: title.toLowerCase().replace(/ /g, "-"),
    title,
    aliases: [],
    path: "",
    unit: "lb",
    range: { low: 8, high: 12, step: 5 },
    sessions: [
      {
        date,
        sets: [],
        topWeight: 80,
        repsAtTop: [],
        est1rm: null,
        progress: "",
        restSeconds: null,
        peakHr: null,
        records: [],
      },
    ],
    records: { heaviest: null, est1rm: null, atTop: null },
    next: { sets: next, reason: "more-reps" },
  };
}

const CHEST = exercise("Chest Press", "2026-11-08", [W(60, 10, true), W(80, 11), W(80, 11)]);
const FLY = exercise("Cable Fly Crossovers", "2026-11-08");
const TRICEP = exercise("Tricep Pushdown", "2026-11-08");
const LEG = exercise("Leg Press", "2026-11-12");

describe("starting an exercise", () => {
  test("one done before opens with next time's sets", () => {
    expect(newDraft("Chest Press", CHEST)).toEqual({
      slug: "chest-press",
      title: "Chest Press",
      unit: "lb",
      sets: [W(60, 10, true), W(80, 11), W(80, 11)],
    });
  });

  test("a new one opens with an empty set, which isn't written until it has reps", () => {
    const draft = newDraft("Romanian Deadlifts ", undefined);

    expect(draft).toMatchObject({ slug: "romanian-deadlift", title: "Romanian Deadlifts" });
    expect(toSave(draft.sets)).toEqual([]);
  });
});

describe("editing sets", () => {
  const sets = [W(60, 10, true), W(80, 11), W(80, 11)];

  test("warm-ups are W and working sets count from 1", () => {
    expect(setLabels(sets)).toEqual(["W", "1", "2"]);
    expect(setLabels(toggleWarmUp(sets, 0))).toEqual(["1", "2", "3"]);
  });

  test("steppers move weight by a plate and reps by one, never below zero", () => {
    expect(stepWeight(sets, 1, 2.5)[1]).toEqual(W(82.5, 11));
    expect(stepWeight([W(2.5, 5)], 0, -2.5)[0]).toEqual(W(null, 5));
    expect(stepReps(sets, 2, -1)[2]).toEqual(W(80, 10));
    expect(stepReps([W(80, 0)], 0, -1)[0]?.reps).toBe(0);
  });

  test("typing a weight; clearing it makes the set bodyweight", () => {
    expect(setWeight(sets, 1, 85)[1]?.weight).toBe(85);
    expect(setWeight(sets, 1, null)[1]?.weight).toBeNull();
  });

  test("a new set copies the last working one", () => {
    expect(addSet(sets)[3]).toEqual(W(80, 11));
    expect(addSet([])[0]).toEqual(W(null, 0));
  });
});

describe("adding an exercise", () => {
  const all = [CHEST, FLY, TRICEP, LEG];

  test("usually next is the rest of the session the current one was last in", () => {
    expect(usuallyNext("chest-press", all, ["chest-press"]).map((e) => e.title)).toEqual([
      "Cable Fly Crossovers",
      "Tricep Pushdown",
    ]);
    expect(usuallyNext("chest-press", all, ["chest-press", "tricep-pushdown"])).toHaveLength(1);
    expect(usuallyNext(undefined, all, [])).toEqual([]);
  });

  test("typing finds exercises not logged yet, and offers a new one", () => {
    expect(addChoices(all, "press", ["chest-press"])).toEqual({
      matches: [LEG],
      newTitle: "press",
    });
    expect(addChoices(all, "leg press", []).newTitle).toBeNull();
    expect(addChoices(all, "", [])).toEqual({ matches: [], newTitle: null });
  });
});
