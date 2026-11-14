import { describe, expect, test } from "bun:test";
import { exerciseKey, exerciseSlug } from "../../src/lifting/names";

describe("exercise names", () => {
  test("ignore case, spacing, punctuation and a plural last word", () => {
    expect(exerciseKey("Cable Fly Crossovers")).toBe(exerciseKey("cable  fly crossover"));
    expect(exerciseKey("Pull-ups")).toBe("pull up");
    expect(exerciseKey("Café Curl")).toBe("cafe curl");
  });

  test("keep a double s, so press stays press", () => {
    expect(exerciseKey("Chest Press")).toBe("chest press");
    expect(exerciseKey("Leg Curls")).toBe(exerciseKey("Leg Curl"));
  });

  test("slug the title for addresses", () => {
    expect(exerciseSlug("Chest Press")).toBe("chest-press");
    expect(exerciseSlug("Dumbbell Shoulder Press")).toBe("dumbbell-shoulder-press");
  });
});
