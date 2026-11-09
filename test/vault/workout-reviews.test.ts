import { describe, expect, test } from "bun:test";
import { readReviews, writeReview } from "../../src/vault/workout-reviews";

describe("workout reviews", () => {
  test("reads reviews and skips malformed entries", () => {
    const reviews = readReviews({
      workout_reviews: [
        { start: "18:07", end: "18:31", kind: "none" },
        { start: "9:00", end: "09:30", kind: "lifting" },
        { start: "20:30", end: "21:15", kind: "dancing" },
        "lifting",
      ],
    });

    expect(reviews).toEqual([{ start: "18:07", end: "18:31", kind: "none" }]);
  });

  test("a new review replaces the old one for the same workout and keeps start order", () => {
    const frontmatter: Record<string, unknown> = {};

    writeReview(frontmatter, { start: "18:07", end: "18:31", kind: "lifting" });
    writeReview(frontmatter, { start: "09:00", end: "09:40", kind: "running" });
    writeReview(frontmatter, { start: "18:07", end: "18:31", kind: "none" });

    expect(frontmatter.workout_reviews).toEqual([
      { start: "09:00", end: "09:40", kind: "running" },
      { start: "18:07", end: "18:31", kind: "none" },
    ]);
  });

  test("taking back the last review removes the key", () => {
    const frontmatter: Record<string, unknown> = {
      workout_reviews: [{ start: "18:07", end: "18:31", kind: "none" }],
    };

    writeReview(frontmatter, { start: "18:07", end: "18:31", kind: null });

    expect(frontmatter).toEqual({});
  });
});
