// Reading and editing Habits.md (docs/habits.md): each top-level `- ` line that isn't a checkbox
// is a habit, `Name <!-- id:… -->`, with its details as sub-bullets (docs/fields.md). Every
// other line is kept exactly as it is. Pure: habit-store.ts reads and writes the file.

import { slugOf } from "../lists/list-store";
import { type Fields, formatFields, itemEnd, readFields, replaceItem } from "../vault/fields";
import { isIsoDate } from "../vault/time";

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
  /** The day it began, so earlier days aren't misses; without one, its first tick. */
  since: string | null;
  state: HabitState;
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
const HEX = /^#?([0-9a-f]{6})$/i;
const MAX_TIMES = 7;

/** The sub-bullet keys a habit owns, in the order they're written. */
export const HABIT_KEYS = ["schedule", "auto", "colour", "since", "status"] as const;

/** Every habit in the note, in note order. A second line with the same id gets `-2`, `-3`, …. */
export function parseHabits(text: string): Habit[] {
  const habits: Habit[] = [];
  const taken = new Set<string>();
  const lines = text.split("\n");
  for (const [line, raw] of lines.entries()) {
    const match = HABIT.exec(raw);
    if (!match) {
      continue;
    }
    const habit = parseLine(match[1] ?? "", line);
    if (habit) {
      readHabitFields(habit, readFields(lines, line, HABIT_KEYS));
      habit.id = unique(habit.id, taken);
      taken.add(habit.id);
      habits.push(habit);
    }
  }
  return habits;
}

function parseLine(entry: string, line: number): Habit | null {
  const idMatch = ID.exec(entry);
  const name = entry.replace(ID, "").trim();
  if (name === "") {
    return null;
  }
  return {
    id: idMatch?.[1] ?? slugOf(name, "habit"),
    name,
    schedule: { kind: "daily" },
    auto: null,
    color: null,
    since: null,
    state: "active",
    line,
  };
}

/** Fills in the habit's fields. Values it can't read are skipped, leaving the default. */
function readHabitFields(habit: Habit, fields: Fields): void {
  const schedule = fields.schedule ? parseSchedule(fields.schedule) : null;
  if (schedule) {
    habit.schedule = schedule;
  }
  if (fields.auto) {
    habit.auto = fields.auto;
  }
  const colour = fields.colour ? HEX.exec(fields.colour)?.[1] : undefined;
  if (colour) {
    habit.color = `#${colour.toUpperCase()}`;
  }
  if (fields.since && isIsoDate(fields.since)) {
    habit.since = fields.since;
  }
  const status = fields.status?.toLowerCase();
  if (status === "paused" || status === "archived" || status === "active") {
    habit.state = status;
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

/** A habit's line and its fields. */
export function habitLines(habit: HabitFields & { id: string }): string[] {
  const fields = {
    schedule: scheduleText(habit.schedule),
    auto: habit.auto ?? undefined,
    colour: habit.color?.replace(/^#/, ""),
    since: habit.since ?? undefined,
    status: habit.state === "active" ? undefined : habit.state,
  };
  return [`- ${habit.name} <!-- id:${habit.id} -->`, ...formatFields(fields, HABIT_KEYS, "")];
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
  const at = last ? itemEnd(lines, last.line) : lines.length;
  lines.splice(at, 0, ...habitLines({ ...fields, id }));
  const next = `${lines.join("\n")}\n`;
  const habit = parseHabits(next).find((h) => h.id === id);
  if (!habit) {
    throw new Error(`added habit ${id} didn't parse back`);
  }
  return { text: next, habit };
}

/**
 * Rewrites one habit's line and fields with `patch`, writing its id so a later rename keeps it.
 * Other bullets under it stay. Returns null when there's no such habit.
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
  replaceItem(lines, habit.line, HABIT_KEYS, habitLines({ ...habit, ...patch }));
  return { text: lines.join("\n"), habit: { ...habit, ...patch } };
}

/** The first palette colour no habit uses yet, or the first one when all are taken. */
export function nextColor(habits: Habit[]): string {
  const used = new Set(habits.map((h) => h.color));
  return HABIT_COLORS.find((c) => !used.has(c)) ?? (HABIT_COLORS[0] as string);
}

/** A habit's name is one line without comment markers, which would break its id. */
export function isValidName(name: string): boolean {
  const trimmed = name.trim();
  return trimmed !== "" && trimmed.length <= 80 && !/\n|<!--|-->/.test(trimmed);
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
