// Your reviews of the strap's workouts, kept in the daily note's frontmatter so they can be read
// and fixed in Obsidian too:
//
//   workout_reviews:
//     - start: "18:07"
//       end: "18:31"
//       kind: none
//
// `start` and `end` are local times of the workout as it was found. `kind` is what it was, or
// `none` when it wasn't a workout.

import type { Frontmatter } from "./markdown";

export const REVIEWS_KEY = "workout_reviews";

export const REVIEW_KINDS = [
  "running",
  "walking",
  "volleyball",
  "lifting",
  "workout",
  "none",
] as const;
export type ReviewKind = (typeof REVIEW_KINDS)[number];

export interface WorkoutReview {
  /** Local HH:MM. */
  start: string;
  end: string;
  kind: ReviewKind;
}

const TIME = /^([01]\d|2[0-3]):[0-5]\d$/;

/** The note's reviews. Malformed entries, say from a typo in Obsidian, are skipped. */
export function readReviews(frontmatter: Frontmatter | undefined): WorkoutReview[] {
  const list = frontmatter?.[REVIEWS_KEY];
  return Array.isArray(list) ? list.flatMap((entry) => toReview(entry)) : [];
}

function toReview(entry: unknown): WorkoutReview[] {
  if (typeof entry !== "object" || entry === null) {
    return [];
  }
  const { start, end, kind } = entry as Record<string, unknown>;
  const valid =
    typeof start === "string" &&
    typeof end === "string" &&
    TIME.test(start) &&
    TIME.test(end) &&
    REVIEW_KINDS.includes(kind as ReviewKind);
  return valid ? [{ start, end, kind: kind as ReviewKind }] : [];
}

/**
 * Set the review for the workout starting at `start`, replacing any earlier one for it. A null
 * `kind` takes the review back. The list stays in start order; an empty list removes the key.
 */
export function writeReview(
  frontmatter: Frontmatter,
  review: { start: string; end: string; kind: ReviewKind | null },
): void {
  const others = readReviews(frontmatter).filter((r) => r.start !== review.start);
  const next = review.kind
    ? [...others, { start: review.start, end: review.end, kind: review.kind }]
    : others;
  if (next.length === 0) {
    delete frontmatter[REVIEWS_KEY];
    return;
  }
  frontmatter[REVIEWS_KEY] = next.sort((a, b) => a.start.localeCompare(b.start));
}
