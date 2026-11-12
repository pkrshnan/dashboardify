// The Habits page's rules, without a DOM (docs/habits.md#web): the GitHub-style grid of weeks,
// the words under a habit's name, and auto rules as the form edits them. Dates are the server's
// YYYY-MM-DD strings, worked on in UTC so the browser's time zone never shifts them.

import { addDays, shortDate } from "./format";

export type ScheduleKind = "daily" | "weekly" | "days";

export interface HabitSchedule {
  kind: ScheduleKind;
  /** For weekly. */
  times: number;
  /** For days: 1 is Monday, 7 Sunday. */
  days: number[];
}

export interface HabitProgress {
  /** YYYY-MM-DD: the habit day it's as of. */
  day: string;
  streak: number;
  unit: "day" | "week";
  atRisk: boolean;
  recentDone: number;
  recentOf: number;
  thisWeek: number;
  due: boolean;
  done: boolean;
}

export interface HabitView {
  /** "habits/meditate". */
  name: string;
  /** "meditate", for the address. */
  id: string;
  displayName: string;
  schedule: HabitSchedule;
  /** The rule, such as "steps ≥ 8000"; "" when ticked by hand. */
  auto: string;
  color: string;
  state: "active" | "paused" | "archived";
  startDate: string;
  progress: HabitProgress;
  etag: string;
}

export type DayMark = "done" | "open" | "pending" | "before";

export interface HabitDayView {
  date: string;
  mark: DayMark;
  scheduled: boolean;
  ticked: boolean;
}

export interface FactView {
  name: string;
  label: string;
  kind: string;
  night: boolean;
  defaultRule: string;
}

/** How a square is drawn: the habit's colour, grey, an outline, dashed, or nothing. */
export type CellState = "done" | "missed" | "off" | "pending" | "empty";

export interface GridCell {
  date: string;
  state: CellState;
  isToday: boolean;
  /** Not after today: the page can tick it. */
  canTick: boolean;
}

export const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

/** The palette the form offers; the server gives a new habit without one the next unused. */
export const HABIT_COLORS = [
  "#BF5AF2",
  "#40C8E0",
  "#64D2FF",
  "#7D7AFF",
  "#FF7EB6",
  "#66D4CF",
  "#AC8E68",
];

/** What the line under "How often" says about how the streak counts. */
export function cadenceNote(schedule: HabitSchedule): string {
  if (schedule.kind === "weekly") {
    return `Any ${schedule.times} ${schedule.times === 1 ? "day" : "days"}, Monday to Sunday. The streak counts weeks.`;
  }
  if (schedule.kind === "days") {
    return "Other days don't count, so a day off never breaks the streak.";
  }
  return "One missed day is forgiven. Two in a row end the streak.";
}
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** 1 for Monday to 7 for Sunday. */
export function dayOfWeek(date: string): number {
  return ((new Date(`${date}T00:00:00Z`).getUTCDay() + 6) % 7) + 1;
}

/** Weeks of the grid back from `today`'s, oldest first; each Monday to Sunday. */
export function gridWeeks(days: HabitDayView[], today: string, weeks: number): GridCell[][] {
  const byDate = new Map(days.map((d) => [d.date, d]));
  const first = gridStart(today, weeks);
  return Array.from({ length: weeks }, (_, w) => {
    return Array.from({ length: 7 }, (_, d) => {
      const date = addDays(first, w * 7 + d);
      const future = date > today;
      return {
        date,
        state: future ? "empty" : cellState(byDate.get(date)),
        isToday: date === today,
        canTick: !future,
      };
    });
  });
}

function cellState(day: HabitDayView | undefined): CellState {
  if (!day || day.mark === "before") {
    return "empty";
  }
  if (day.mark === "done") {
    return "done";
  }
  if (!day.scheduled) {
    return "off";
  }
  return day.mark === "pending" ? "pending" : "missed";
}

/** The first day each column needs to cover, for ListHabitDays. */
export function gridStart(today: string, weeks: number): string {
  return addDays(today, -(dayOfWeek(today) - 1) - (weeks - 1) * 7);
}

/** A month's name over the column holding its first Monday, else "". */
export function monthLabels(weeks: GridCell[][]): string[] {
  return weeks.map((week) => {
    const [, month, day] = (week[0]?.date ?? "2000-01-08").split("-").map(Number);
    return (day ?? 8) <= 7 ? (MONTHS[(month ?? 1) - 1] ?? "") : "";
  });
}

/** "Every day", "3× a week", "Sun–Thu" for a run of days, or "Mon Wed Fri". */
export function scheduleLabel(schedule: HabitSchedule): string {
  if (schedule.kind === "weekly") {
    return `${schedule.times}× a week`;
  }
  if (schedule.kind === "daily" || schedule.days.length === 7) {
    return "Every day";
  }
  const days = [...schedule.days].sort((a, b) => a - b);
  const start = runStart(days);
  if (start !== null && days.length >= 3) {
    return `${WEEKDAYS[start - 1]}–${WEEKDAYS[(start + days.length - 2) % 7]}`;
  }
  return days.map((d) => WEEKDAYS[d - 1]).join(" ");
}

/** The day a single run of days (wrapping past Sunday) starts on, or null for several runs. */
function runStart(days: number[]): number | null {
  const starts = days.filter((d) => !days.includes(d === 1 ? 7 : d - 1));
  return starts.length === 1 ? (starts[0] ?? null) : null;
}

export interface RuleParts {
  /** "" when it's ticked by hand. */
  fact: string;
  /** A number, or HH:MM for a time. */
  value: string;
}

const RULE = /^([a-z0-9_]+)(?:\s*(?:≥|≤|>=|<=)\s*(\S+))?$/;

/** A rule as the form edits it; a bare fact takes its default's value. */
export function ruleParts(auto: string, facts: FactView[]): RuleParts {
  const match = RULE.exec(auto.trim());
  const fact = facts.find((f) => f.name === match?.[1]);
  if (!(match && fact)) {
    return { fact: "", value: "" };
  }
  return { fact: fact.name, value: match[2] ?? defaultValue(fact) };
}

export function defaultValue(fact: FactView): string {
  return fact.defaultRule.split(/\s+/).at(-1) ?? "";
}

/** "steps ≥ 8000", "lights_out ≤ 23:30"; "" by hand. A time is a deadline, the rest a minimum. */
export function ruleText(parts: RuleParts, facts: FactView[]): string {
  const fact = facts.find((f) => f.name === parts.fact);
  if (!fact) {
    return "";
  }
  const op = fact.kind === "time" ? "≤" : "≥";
  return `${fact.name} ${op} ${parts.value.trim() || defaultValue(fact)}`;
}

/** What ticks it, under the name: "8,000+ steps", "by 23:30", "Lifting". */
export function ruleLabel(auto: string, facts: FactView[]): string {
  const { fact, value } = ruleParts(auto, facts);
  const def = facts.find((f) => f.name === fact);
  if (!def) {
    return "";
  }
  if (def.kind === "time") {
    return `by ${value}`;
  }
  const count = Number(value);
  if (def.kind === "count" && count === 1) {
    return def.label;
  }
  return `${def.label} ${count.toLocaleString("en-GB")}+`;
}

/** The line under the streak: at risk, or the recent count. */
export function progressNote(habit: HabitView, facts: FactView[]): string {
  const { progress } = habit;
  if (progress.atRisk) {
    const night = facts.find((f) => f.name === ruleParts(habit.auto, facts).fact)?.night;
    return night ? "Missed last night · tonight keeps it" : "Missed yesterday · tick today";
  }
  const unit = progress.unit === "week" ? "weeks" : "days";
  return `${progress.recentDone} of ${progress.recentOf}, last ${progress.unit === "week" ? 4 : 30} ${unit}`;
}

/** The dots under a weekly habit's streak: one per time, filled for each day done this week. */
export function weekDots(habit: HabitView): boolean[] {
  if (habit.schedule.kind !== "weekly") {
    return [];
  }
  return Array.from({ length: habit.schedule.times }, (_, i) => i < habit.progress.thisWeek);
}

/** "Wed 4 Nov". */
export function dayLabel(date: string): string {
  return shortDate(date);
}

/** The days shown with a tick flipped, so the square changes before the server answers. */
export function withTick(days: HabitDayView[], date: string, done: boolean): HabitDayView[] {
  const found = days.some((d) => d.date === date);
  const flipped = days.map((d) =>
    d.date === date
      ? { ...d, mark: done ? ("done" as const) : ("open" as const), ticked: done }
      : d,
  );
  return found
    ? flipped
    : [...flipped, { date, mark: done ? "done" : "open", scheduled: true, ticked: done }];
}
