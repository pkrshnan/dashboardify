// Reading and writing single Obsidian Tasks lines. Pure functions only; see task-store.ts for
// the code that finds tasks in the vault and edits them.
//
// A task line looks like:
//   - [ ] Call the bank ⏰ 09:00 ⏫ 🔁 every week 📅 2026-11-03 ➕ 2026-11-02 🆔 k7f3a2
// Tasks reads its emoji fields from the end of the line, in any order. `⏰ HH:MM` is our own
// extension for a due time, so it always sits right after the description, before every Tasks
// field; otherwise Tasks would treat the fields before it as description text.

export type Priority = "highest" | "high" | "medium" | "low" | "lowest";

export interface Task {
  done: boolean;
  description: string;
  /** HH:MM; our extension, only meaningful with a due date. */
  time?: string;
  priority?: Priority;
  /** Tasks recurrence rule, e.g. "every week". */
  recurrence?: string;
  due?: string;
  created?: string;
  completed?: string;
  id?: string;
}

const PRIORITY_EMOJI: Record<Priority, string> = {
  highest: "🔺",
  high: "⏫",
  medium: "🔼",
  low: "🔽",
  lowest: "⏬",
};
const EMOJI_PRIORITY = new Map(Object.entries(PRIORITY_EMOJI).map(([p, e]) => [e, p as Priority]));

const CHECKBOX = /^(\s*[-*] \[)(.)(\] )(.*)$/u;
const DATE = String.raw`(\d{4}-\d{2}-\d{2})`;
/** Tasks fields we understand, each anchored at the end of the remaining text. */
const TRAILING_FIELDS: [keyof Task, RegExp][] = [
  ["id", /\s*🆔 ([A-Za-z0-9_-]+)$/u],
  ["completed", new RegExp(String.raw`\s*✅ ${DATE}$`, "u")],
  ["created", new RegExp(String.raw`\s*➕ ${DATE}$`, "u")],
  ["due", new RegExp(String.raw`\s*📅 ${DATE}$`, "u")],
  ["recurrence", /\s*🔁 ([a-zA-Z0-9 ,]+?)$/u],
  ["priority", /\s*(🔺|⏫|🔼|🔽|⏬)$/u],
];
const TIME = /\s*⏰ (\d{2}:\d{2})$/u;

/** Parse a checklist line. Returns null for lines that aren't tasks. */
export function parseTaskLine(line: string): Task | null {
  const match = CHECKBOX.exec(line);
  if (!match) {
    return null;
  }
  const status = match[2] ?? " ";
  const task: Task = { done: status !== " ", description: "" };
  const rest = stripTrailingFields(match[4] ?? "", task);
  const time = TIME.exec(rest);
  task.description = (time ? rest.slice(0, time.index) : rest).trim();
  if (time?.[1]) {
    task.time = time[1];
  }
  return task;
}

/** Peel known fields off the end of the text until none match, filling them into `task`. */
function stripTrailingFields(text: string, task: Task): string {
  let rest = text.trimEnd();
  let found = true;
  while (found) {
    found = false;
    for (const [field, pattern] of TRAILING_FIELDS) {
      const match = pattern.exec(rest);
      if (match?.[1] && task[field] === undefined) {
        setField(task, field, match[1]);
        rest = rest.slice(0, match.index);
        found = true;
      }
    }
  }
  return rest;
}

function setField(task: Task, field: keyof Task, value: string): void {
  if (field === "priority") {
    task.priority = EMOJI_PRIORITY.get(value);
    return;
  }
  (task as unknown as Record<string, string>)[field] = value;
}

/** Render a task as one line. `indent` keeps a nested task's leading whitespace. */
export function formatTask(task: Task, indent = ""): string {
  const parts = [`${indent}- [${task.done ? "x" : " "}] ${task.description}`];
  if (task.time) {
    parts.push(`⏰ ${task.time}`);
  }
  if (task.priority) {
    parts.push(PRIORITY_EMOJI[task.priority]);
  }
  addField(parts, "🔁", task.recurrence);
  addField(parts, "📅", task.due);
  addField(parts, "➕", task.created);
  addField(parts, "✅", task.completed);
  addField(parts, "🆔", task.id);
  return parts.join(" ");
}

function addField(parts: string[], emoji: string, value: string | undefined): void {
  if (value) {
    parts.push(`${emoji} ${value}`);
  }
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
