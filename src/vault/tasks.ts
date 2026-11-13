// Reading and writing tasks. Pure functions only; see task-store.ts for the code that finds
// tasks in the vault and edits them.
//
// A task is a checkbox line with its details as sub-bullets (docs/fields.md):
//   - [ ] Call the bank <!-- id:k7f3a2 -->
//   	- due: 2026-11-03 09:00
//   	- repeat: every week
// Older lines carry Obsidian Tasks emoji instead:
//   - [ ] Call the bank ⏰ 09:00 ⏫ 🔁 every week 📅 2026-11-03 ➕ 2026-11-02 🆔 k7f3a2
// They're still read, but never written: an edit rewrites a task in the new form.

import { formatFields, readFields } from "./fields";

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

export interface Task {
  done: boolean;
  description: string;
  /** HH:MM, only meaningful with a due date. */
  time?: string;
  priority?: Priority;
  /** Recurrence rule, e.g. "every week". */
  recurrence?: string;
  due?: string;
  completed?: string;
  id?: string;
}

/** The sub-bullet keys a task owns, in the order they're written. */
export const TASK_KEYS = ["due", "repeat", "priority", "done"] as const;

const PRIORITIES: readonly Priority[] = ["highest", "high", "medium", "low", "lowest"];
const PRIORITY_EMOJI: Record<Priority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};
const EMOJI_PRIORITY = new Map(Object.entries(PRIORITY_EMOJI).map(([p, e]) => [e, p as Priority]));

const CHECKBOX = /^(\s*[-*] \[)(.)(\] )(.*)$/u;
const ID = /\s*<!--\s*id:([A-Za-z0-9_-]+)\s*-->\s*$/u;
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;
const DUE = new RegExp(String.raw`^${DATE}(?:\s+(\d{2}:\d{2}))?$`, "u");
const DONE = new RegExp(String.raw`^${DATE}$`, "u");
/** Old Tasks fields, each anchored at the end of the remaining text. */
const TRAILING_FIELDS: [keyof Task | "created", RegExp][] = [
  ["id", /\s*🆔 ([A-Za-z0-9_-]+)$/u],
  ["completed", new RegExp(String.raw`\s*✅ ${DATE}$`, "u")],
  ["created", new RegExp(String.raw`\s*➕ ${DATE}$`, "u")],
  ["due", new RegExp(String.raw`\s*📅 ${DATE}$`, "u")],
  ["recurrence", /\s*🔁 ([a-zA-Z0-9 ,]+?)$/u],
  ["priority", /\s*(🔺|⏫|🔼|🔽|⏬)$/u],
];
const TIME = /\s*⏰ (\d{2}:\d{2})$/u;

/**
 * The task at `index` with its sub-bullet fields, or null when the line isn't a task. A field
 * wins over the same detail written the old way on the line.
 */
export function parseTask(lines: string[], index: number): Task | null {
  const task = parseTaskLine(lines[index] ?? "");
  if (!task) {
    return null;
  }
  const fields = readFields(lines, index, TASK_KEYS);
  const due = fields.due ? DUE.exec(fields.due) : null;
  if (due?.[1]) {
    task.due = due[1];
    task.time = due[2];
  }
  if (fields.repeat) {
    task.recurrence = fields.repeat;
  }
  const priority = fields.priority?.toLowerCase();
  if (PRIORITIES.includes(priority as Priority)) {
    task.priority = priority as Priority;
  }
  if (fields.done && DONE.test(fields.done)) {
    task.completed = fields.done;
  }
  return task;
}

/** Parse a checklist line on its own, without its fields. Returns null for other lines. */
export function parseTaskLine(line: string): Task | null {
  const match = CHECKBOX.exec(line);
  if (!match) {
    return null;
  }
  const status = match[2] ?? " ";
  const task: Task = { done: status !== " ", description: "" };
  let rest = match[4] ?? "";
  const id = ID.exec(rest);
  if (id?.[1]) {
    task.id = id[1];
    rest = rest.slice(0, id.index);
  }
  rest = stripTrailingFields(rest, task);
  const time = TIME.exec(rest);
  task.description = (time ? rest.slice(0, time.index) : rest).trim();
  if (time?.[1]) {
    task.time = time[1];
  }
  return task;
}

/** Whether a task line still carries old Tasks emoji fields, so converting it would change it. */
export function hasOldFields(line: string): boolean {
  const task = parseTaskLine(line);
  const text = CHECKBOX.exec(line)?.[4] ?? "";
  return task !== null && task.description !== text.replace(ID, "").trim();
}

/** Peel old Tasks fields off the end of the text until none match, filling them into `task`. */
function stripTrailingFields(text: string, task: Task): string {
  const seen = new Set<string>();
  let rest = text.trimEnd();
  let found = true;
  while (found) {
    found = false;
    for (const [field, pattern] of TRAILING_FIELDS) {
      const match = pattern.exec(rest);
      if (match?.[1] && !seen.has(field) && task[field as keyof Task] === undefined) {
        seen.add(field);
        setField(task, field, match[1]);
        rest = rest.slice(0, match.index);
        found = true;
      }
    }
  }
  return rest;
}

function setField(task: Task, field: keyof Task | "created", value: string): void {
  if (field === "created") {
    // No longer kept; peeled off so it doesn't end up in the description.
    return;
  }
  if (field === "priority") {
    task.priority = EMOJI_PRIORITY.get(value);
    return;
  }
  (task as unknown as Record<string, string>)[field] = value;
}

/** A task's line and its fields. `indent` keeps a nested task's leading whitespace. */
export function formatTask(task: Task, indent = ""): string[] {
  const id = task.id ? ` <!-- id:${task.id} -->` : "";
  const line = `${indent}- [${task.done ? "x" : " "}] ${task.description}${id}`;
  const due = task.due && task.time ? `${task.due} ${task.time}` : task.due;
  const fields = {
    due,
    repeat: task.recurrence,
    priority: task.priority,
    done: task.done ? task.completed : undefined,
  };
  return [line, ...formatFields(fields, TASK_KEYS, indent)];
}

/** The leading whitespace of a line. */
export function indentOf(line: string): string {
  return /^\s*/.exec(line)?.[0] ?? "";
}

const RULE = /^every (?:(\d+) )?(day|week|month|year)s?$/;
const UNITS = { day: "days", week: "weeks", month: "months", year: "years" } as const;

/**
 * The next due date for a recurring task, counted from its due date the way Tasks does.
 * Supports "every [N] day|week|month|year(s)" and "every weekday"; returns null for anything
 * else, so the caller can complete the task without guessing.
 */
export function nextDue(rule: string, due: string): string | null {
  const date = Temporal.PlainDate.from(due);
  if (rule === "every weekday") {
    return nextWeekday(date).toString();
  }
  const match = RULE.exec(rule.trim());
  const unit = match?.[2] as keyof typeof UNITS | undefined;
  if (!unit) {
    return null;
  }
  return date.add({ [UNITS[unit]]: Number(match?.[1] ?? 1) }).toString();
}

function nextWeekday(date: Temporal.PlainDate): Temporal.PlainDate {
  let next = date.add({ days: 1 });
  while (next.dayOfWeek > 5) {
    next = next.add({ days: 1 });
  }
  return next;
}
