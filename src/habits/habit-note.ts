// Reading and editing Habits.md (docs/habits.md): each top-level `- ` line that isn't a checkbox
// is a habit, `Name · field · field <!-- id:… -->`. Every other line is kept exactly as it is.
// Pure: habit-store.ts reads and writes the file.

import { slugOf } from "../lists/list-store";

/** 1 is Monday and 7 is Sunday, as Temporal counts them. */
export type Weekday = 1 | 2 | 3 | 4 | 5 | 6 | 7;

export type Schedule =
  | { kind: "daily" }
  | { kind: "weekly"; times: number }
  | { kind: "days"; days: Weekday[] };

export type HabitState = "active" | "paused" | "archived";

export interface Habit {
  /** From the line's `<!-- id:… -->`, or the name's slug when the line has none. */
  id: string;
  name: string;
  schedule: Schedule;
  /** The rule after `auto`, as written: "steps ≥ 8000". Checked by facts.ts. */
  auto: string | null;
  color: string | null;
  state: HabitState;
  /** Fields this version doesn't know, kept so rewriting the line doesn't drop them. */
  extra: string[];
  line: number;
}

export type HabitFields = Omit<Habit, "id" | "line">;

/** The palette the page offers (docs/design/README.md); a new habit takes the next unused. */
export const HABIT_COLORS = [
  "#BF5AF2",
  "#40C8E0",
  "#64D2FF",
  "#7D7AFF",
  "#FF7EB6",
  "#66D4CF",
  "#AC8E68",
];

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

const HABIT = /^[-*] (?!\[[ xX]\] )(.+)$/;
const ID = /\s*<!--\s*id:([a-z0-9-]+)\s*-->\s*$/;
const WEEKLY = /^([1-7])\s*(?:×|x|times)?\s*(?:a|per)\s+week$/i;
const COLOR = /^#[0-9a-f]{6}$/i;
const SEPARATOR = " · ";
const MAX_TIMES = 7;

/** Every habit in the note, in note order. A second line with the same id gets `-2`, `-3`, …. */
export function parseHabits(text: string): Habit[] {
  const habits: Habit[] = [];
  const taken = new Set<string>();
  for (const [line, raw] of text.split("\n").entries()) {
    const match = HABIT.exec(raw);
    if (!match) {
      continue;
    }
    const habit = parseLine(match[1] ?? "", line);
    if (habit) {
      habit.id = unique(habit.id, taken);
      taken.add(habit.id);
      habits.push(habit);
    }
  }
  return habits;
}

function parseLine(entry: string, line: number): Habit | null {
  const idMatch = ID.exec(entry);
  const [name = "", ...fields] = entry
    .replace(ID, "")
    .split("·")
    .map((f) => f.trim());
  if (name === "") {
    return null;
  }
  const habit: Habit = {
    id: idMatch?.[1] ?? slugOf(name, "habit"),
    name,
    schedule: { kind: "daily" },
    auto: null,
    color: null,
    state: "active",
    extra: [],
    line,
  };
  for (const field of fields.filter((f) => f !== "")) {
    readField(habit, field);
  }
  return habit;
}

function readField(habit: Habit, field: string): void {
  const schedule = parseSchedule(field);
  const lower = field.toLowerCase();
  if (schedule) {
    habit.schedule = schedule;
  } else if (lower.startsWith("auto ")) {
    habit.auto = field.slice(5).trim();
  } else if (COLOR.test(field)) {
    habit.color = field.toUpperCase();
  } else if (lower === "paused" || lower === "archived") {
    habit.state = lower;
  } else {
    habit.extra.push(field);
  }
}

/** "daily", "every day", "3 a week", "3× a week", or weekdays: "Mon Wed Fri". */
export function parseSchedule(field: string): Schedule | null {
  const lower = field.trim().toLowerCase();
  if (lower === "daily" || lower === "every day") {
    return { kind: "daily" };
  }
  const weekly = WEEKLY.exec(lower);
  if (weekly) {
    return { kind: "weekly", times: Number(weekly[1]) };
  }
  const days = lower.split(/[\s,]+/).map((d) => WEEKDAYS.findIndex((w) => w.toLowerCase() === d));
  if (days.length > 0 && days.every((d) => d >= 0)) {
    return { kind: "days", days: sortedDays(days.map((d) => (d + 1) as Weekday)) };
  }
  return null;
}

export function scheduleText(schedule: Schedule): string {
  if (schedule.kind === "weekly") {
    return `${schedule.times} a week`;
  }
  if (schedule.kind === "days") {
    return schedule.days.map((d) => WEEKDAYS[d - 1]).join(" ");
  }
  return "daily";
}

/** A schedule the API can accept: 1–7 a week, at least one weekday. */
export function isValidSchedule(schedule: Schedule): boolean {
  if (schedule.kind === "weekly") {
    return Number.isInteger(schedule.times) && schedule.times >= 1 && schedule.times <= MAX_TIMES;
  }
  if (schedule.kind === "days") {
    return schedule.days.length > 0 && schedule.days.every((d) => d >= 1 && d <= 7);
  }
  return true;
}

export function habitLine(habit: HabitFields & { id: string }): string {
  const fields = [habit.name, scheduleText(habit.schedule)];
  if (habit.auto) {
    fields.push(`auto ${habit.auto}`);
  }
  if (habit.color) {
    fields.push(habit.color);
  }
  if (habit.state !== "active") {
    fields.push(habit.state);
  }
  return `- ${[...fields, ...habit.extra].join(SEPARATOR)} <!-- id:${habit.id} -->`;
}

/**
 * Adds a habit at the end of the note's last run of habit lines (or the end of the note), with
 * an id no other habit has. Returns the new text and the habit as parsed back.
 */
export function addHabit(text: string, fields: HabitFields): { text: string; habit: Habit } {
  const existing = parseHabits(text);
  const id = unique(slugOf(fields.name, "habit"), new Set(existing.map((h) => h.id)));
  const lines = text === "" ? [] : text.replace(/\n$/, "").split("\n");
  const last = existing.at(-1);
  const isFirst = !last && lines.length > 0 && (lines.at(-1) ?? "").trim() !== "";
  if (isFirst) {
    lines.push("");
  }
  lines.splice(last ? last.line + 1 : lines.length, 0, habitLine({ ...fields, id }));
  const next = `${lines.join("\n")}\n`;
  const habit = parseHabits(next).find((h) => h.id === id);
  if (!habit) {
    throw new Error(`added habit ${id} didn't parse back`);
  }
  return { text: next, habit };
}

/**
 * Rewrites one habit's line with `patch`, writing its id so a later rename keeps it. Returns
 * null when there's no such habit.
 */
export function updateHabit(
  text: string,
  id: string,
  patch: Partial<HabitFields>,
): { text: string; habit: Habit } | null {
  const habit = parseHabits(text).find((h) => h.id === id);
  if (!habit) {
    return null;
  }
  const lines = text.split("\n");
  lines[habit.line] = habitLine({ ...habit, ...patch });
  return { text: lines.join("\n"), habit: { ...habit, ...patch } };
}

/** The first palette colour no habit uses yet, or the first one when all are taken. */
export function nextColor(habits: Habit[]): string {
  const used = new Set(habits.map((h) => h.color));
  return HABIT_COLORS.find((c) => !used.has(c)) ?? (HABIT_COLORS[0] as string);
}

/** A habit's name can't hold `·` (the field separator) or comment markers, or be empty. */
export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && trimmed.length <= 80 && !/[·\n]|<!--|-->/.test(trimmed);
}

function unique(id: string, taken: Set<string>): string {
  if (!taken.has(id)) {
    return id;
  }
  let n = 2;
  while (taken.has(`${id}-${n}`)) {
    n++;
  }
  return `${id}-${n}`;
}

function sortedDays(days: Weekday[]): Weekday[] {
  return [...new Set(days)].sort((a, b) => a - b);
}
