// The one sentence at the top of the home screen. It gives a judgement and the next action, and
// doesn't repeat the numbers shown right under it. Rule-based for now; a local model can write
// it later from the same inputs.

import type { AgendaEvent, MetricTrend, NextEvent, TaskGroup } from "./types";

export interface SentenceInput {
  next: NextEvent | null;
  /** Today's all-day events. */
  allDay: AgendaEvent[];
  health: MetricTrend[];
  tasks: TaskGroup[];
}

export function daySentence(input: SentenceInput): string {
  const parts = [
    allDayPart(input.allDay),
    eventPart(input.next),
    healthPart(input.health),
    overduePart(input.tasks),
  ].filter((p): p is string => p !== null);
  return parts.length > 0 ? parts.join(" ") : "Nothing else on today.";
}

/**
 * A calendar shared as free/busy only, like a work one, titles every event "Busy". Name the
 * calendar instead, since "Busy is on now" reads badly and says nothing.
 */
function privateTitle(e: { title: string; calendarName?: string }): string | null {
  if (e.title.trim().toLowerCase() !== "busy") {
    return null;
  }
  return e.calendarName ? `Private ${e.calendarName} event` : "Private event";
}

/** Only private blocks: other all-day events, like a trip, are context rather than news. */
function allDayPart(allDay: AgendaEvent[]): string | null {
  const titles = [...new Set(allDay.map(privateTitle).filter((t): t is string => t !== null))];
  return titles.length > 0 ? `${titles.join(" and ")} all day.` : null;
}

function eventPart(next: NextEvent | null): string | null {
  if (!next) {
    return null;
  }
  const busy = privateTitle(next);
  if (next.inMin <= 0) {
    return busy ? `${busy} on now.` : `${next.title} is on now.`;
  }
  return `${busy ?? next.title} at ${next.start}.`;
}

const RECOVERY_LOW = 34;
const RECOVERY_HIGH = 67;

function healthPart(health: MetricTrend[]): string | null {
  const recovery = health.find((m) => m.key === "recovery");
  const sleep = health.find((m) => m.key === "sleepScore");
  const pct = recovery?.raw ?? null;
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
