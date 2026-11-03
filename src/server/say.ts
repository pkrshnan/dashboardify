// Short sentences for Siri to read aloud. Kept apart from the routes so the wording is easy to
// find and change.

import type { Task } from "../vault/tasks";

export type DueFilter = "today" | "overdue" | "week" | "all";

export function sayAdded(task: Task, today: string): string {
  return `Added ${task.description}${task.due ? `, due ${spokenDay(task.due, today)}` : ""}${task.time ? ` at ${task.time}` : ""}.`;
}

export function sayAlreadyAdded(task: Task): string {
  return `${task.description} is already on your list.`;
}

export function sayCompleted(task: Task, next: Task | undefined, today: string): string {
  if (next?.due) {
    return `Done: ${task.description}. Next one is ${spokenDay(next.due, today)}.`;
  }
  return `Done: ${task.description}.`;
}

const EMPTY: Record<DueFilter, string> = {
  today: "Nothing due today.",
  overdue: "Nothing overdue.",
  week: "Nothing due this week.",
  all: "No open tasks.",
};
const HEADING: Record<DueFilter, string> = {
  today: "due today",
  overdue: "overdue",
  week: "due this week",
  all: "open",
};

/** "3 tasks due today: A, B and C." Long lists are cut to the first five. */
export function sayList(tasks: Task[], filter: DueFilter): string {
  if (tasks.length === 0) {
    return EMPTY[filter];
  }
  const names = tasks.slice(0, 5).map((t) => t.description);
  const more = tasks.length - names.length;
  const noun = tasks.length === 1 ? "task" : "tasks";
  const list = more > 0 ? `${names.join(", ")} and ${more} more` : joinAnd(names);
  return `${tasks.length} ${noun} ${HEADING[filter]}: ${list}.`;
}

function joinAnd(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

/** "today", "tomorrow", a weekday within the week, otherwise the date itself. */
function spokenDay(date: string, today: string): string {
  const days = Temporal.PlainDate.from(today).until(date, { largestUnit: "days" }).days;
  if (days === 0) {
    return "today";
  }
  if (days === 1) {
    return "tomorrow";
  }
  if (days > 1 && days < 7) {
    return Temporal.PlainDate.from(date).toLocaleString("en-US", { weekday: "long" });
  }
  return Temporal.PlainDate.from(date).toLocaleString("en-US", { month: "long", day: "numeric" });
}
