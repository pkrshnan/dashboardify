// The one sentence at the top of the home screen. It gives a judgement and the next action, and
// doesn't repeat the numbers shown right under it. Rule-based for now; a local model can write
// it later from the same inputs.

import type { MetricTrend, NextEvent, TaskGroup } from "./types";

export interface SentenceInput {
  next: NextEvent | null;
  health: MetricTrend[];
  tasks: TaskGroup[];
}

export function daySentence(input: SentenceInput): string {
  const parts = [eventPart(input.next), healthPart(input.health), overduePart(input.tasks)].filter(
    (p): p is string => p !== null,
  );
  return parts.length > 0 ? parts.join(" ") : "Nothing else on today.";
}

function eventPart(next: NextEvent | null): string | null {
  if (!next) {
    return null;
  }
  if (next.inMin <= 0) {
    return `${next.title} is on now.`;
  }
  return `${next.title} at ${next.start}.`;
}

const RECOVERY_LOW = 34;
const RECOVERY_HIGH = 67;

function healthPart(health: MetricTrend[]): string | null {
  const recovery = health.find((m) => m.key === "recovery");
  const sleep = health.find((m) => m.key === "sleepScore");
  const pct = recovery?.yesterday ? null : (recovery?.raw ?? null);
  if (pct === null) {
    return null;
  }
  if (pct < RECOVERY_LOW || recovery?.tone === "bad") {
    return "Recovery is below your usual, so keep today easy.";
  }
  if (pct >= RECOVERY_HIGH && recovery?.tone === "good") {
    return "Recovery is up, so it's a good day to push.";
  }
  if (sleep?.tone === "bad") {
    return "Sleep has been below your usual, so aim for an early night.";
  }
  return null;
}

/** At most one mention of overdue tasks. */
function overduePart(tasks: TaskGroup[]): string | null {
  const overdue = tasks.find((g) => g.name === "Overdue")?.tasks ?? [];
  const [first] = overdue;
  if (!first) {
    return null;
  }
  if (overdue.length > 1) {
    return `${first.text} and ${overdue.length - 1} more are overdue.`;
  }
  const days = Number.parseInt(first.meta, 10);
  return `${first.text} is ${days === 1 ? "a day" : `${days} days`} late.`;
}
