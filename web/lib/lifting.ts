// The Lifting page's rules, kept out of the components so they can be tested without a DOM:
// grouping exercises by the day you last did them, searching, the labels, and the geometry of the
// weight and reps charts. docs/lifting.md has the page.

import { groupsText, round, setRuns } from "../../src/lifting/log-edit";
import type { ExerciseView, SessionView, WorkSetView } from "../api";

export type ChartRange = "3m" | "1y" | "all";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export interface DayGroup {
  date: string;
  /** "Thu 12 Nov" */
  label: string;
  exercises: ExerciseView[];
}

/** Each exercise under the day it was last done, newest day first. */
export function byLastDay(exercises: ExerciseView[]): DayGroup[] {
  const groups = new Map<string, ExerciseView[]>();
  for (const e of exercises) {
    const date = e.sessions[0]?.date ?? "";
    groups.set(date, [...(groups.get(date) ?? []), e]);
  }
  return [...groups]
    .sort(([a], [b]) => b.localeCompare(a))
    .map(([date, list]) => ({ date, label: weekdayLabel(date), exercises: list }));
}

/** By title or alias, ignoring case. */
export function matching(exercises: ExerciseView[], query: string): ExerciseView[] {
  const q = query.trim().toLowerCase();
  if (q === "") {
    return exercises;
  }
  return exercises.filter((e) => [e.title, ...e.aliases].some((n) => n.toLowerCase().includes(q)));
}

/** "2026-11-12" → "Thu 12 Nov" */
export function weekdayLabel(date: string): string {
  const day = new Date(`${date}T12:00:00Z`);
  if (Number.isNaN(day.getTime())) {
    return date;
  }
  return `${DAYS[(day.getUTCDay() + 6) % 7]} ${dayMonth(date)}`;
}

/** "2026-11-08" → "8 Nov" */
export function dayMonth(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

export interface RunText {
  text: string;
  warmUp: boolean;
}

/** Each run of sets at one weight: "80 lb, 2x11, 1x10", warm-ups marked so they can be dimmed. */
export function runTexts(sets: WorkSetView[], unit: string): RunText[] {
  return setRuns(sets).map((run) => ({
    text:
      run.weight === null ? groupsText(run) : `${round(run.weight)} ${unit}, ${groupsText(run)}`,
    warmUp: run.warmUp,
  }));
}

/** The working sets only, as one line: "80 lb, 3x10". */
export function workingText(sets: WorkSetView[], unit: string): string {
  return runTexts(
    sets.filter((s) => !s.warmUp),
    unit,
  )
    .map((r) => r.text)
    .join(" · ");
}

export function progressLabel(progress: SessionView["progress"]): string {
  const labels = { weight: "↑ weight", reps: "↑ reps", same: "=", down: "↓", "": "" };
  return labels[progress];
}

/** "2:05" */
export function restLabel(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

/** The sessions in the chart's range, oldest first. `sessions` come newest first. */
export function inRange(sessions: SessionView[], range: ChartRange, today: string): SessionView[] {
  const days = { "3m": 92, "1y": 366, all: Number.POSITIVE_INFINITY }[range];
  const from = Date.parse(`${today}T00:00:00Z`) - days * 86_400_000;
  return sessions.filter((s) => Date.parse(`${s.date}T00:00:00Z`) >= from).reverse();
}

export interface Plot {
  width: number;
  height: number;
  /** Left margin for the y labels. */
  left: number;
  /** Bottom margin for the month labels. */
  bottom: number;
}

/** About the size each chart is drawn on desktop, so its labels stay readable. */
export const PLOT: Plot = { width: 420, height: 180, left: 34, bottom: 22 };

export interface WeightChart {
  /** The top weight as steps. */
  steps: string;
  /** The est. 1RM as a polyline's points. */
  estimate: string;
  dots: { x: number; y: number; heaviest: boolean }[];
  ticks: { y: number; label: string }[];
  months: { x: number; label: string }[];
}

/** Top weight as steps and est. 1RM as a line, on one scale; null for bodyweight. */
export function weightChart(sessions: SessionView[], plot = PLOT): WeightChart | null {
  const weighted = sessions.filter((s) => s.topWeight !== null);
  if (weighted.length === 0) {
    return null;
  }
  const values = weighted.flatMap((s) => [s.topWeight ?? 0, s.est1rm ?? s.topWeight ?? 0]);
  const y = scale(Math.min(...values), Math.max(...values), plot);
  const x = timeScale(weighted, plot);
  const points = weighted.map((s) => ({
    x: x(s.date),
    top: y(s.topWeight ?? 0),
    est: y(s.est1rm ?? 0),
  }));
  const steps = points.map((p, i) => {
    const before = points[i - 1];
    return before ? `H${fix(p.x)}V${fix(p.top)}` : `M${fix(p.x)} ${fix(p.top)}`;
  });
  return {
    steps: steps.join(""),
    estimate: points.map((p) => `${fix(p.x)},${fix(p.est)}`).join(" "),
    dots: weighted.map((s, i) => ({
      x: points[i]?.x ?? 0,
      y: points[i]?.top ?? 0,
      heaviest: s.records.includes("heaviest"),
    })),
    ticks: [...new Set(weighted.map((s) => s.topWeight ?? 0))].map((w) => ({
      y: y(w),
      label: String(round(w)),
    })),
    months: monthTicks(weighted, x),
  };
}

export interface RepsChart {
  bars: { x: number; y: number; width: number; height: number; shade: number }[];
  groups: { x: number; label: string }[];
  /** Dividers between weights. */
  dividers: number[];
  months: { x: number; label: string }[];
}

/** Reps at the top weight per session, grouped by weight, so the saw of double progression shows. */
export function repsChart(sessions: SessionView[], unit: string, plot = PLOT): RepsChart | null {
  if (sessions.length === 0) {
    return null;
  }
  const totals = sessions.map((s) => s.repsAtTop.reduce((a, b) => a + b, 0));
  const top = Math.max(...totals, 1);
  const floor = plot.height - plot.bottom;
  const x = timeScale(sessions, plot);
  const runs = weightRuns(sessions);
  // Narrower bars as more sessions share the width; a year of them still don't touch.
  const width = Math.max(3, Math.min(22, ((plot.width - plot.left) / sessions.length) * 0.6));
  const bars = sessions.map((s, i) => {
    const height = ((totals[i] ?? 0) / top) * (floor - 18);
    const run = runs.findIndex((r) => r.from <= i && i <= r.to);
    return { x: x(s.date), y: floor - height, width, height, shade: run % 3 };
  });
  return {
    bars,
    groups: runs.map((r) => ({
      x: ((bars[r.from]?.x ?? 0) + (bars[r.to]?.x ?? 0)) / 2,
      label: r.weight === null ? "bodyweight" : `${round(r.weight)} ${unit}`,
    })),
    dividers: runs.slice(1).map((r) => ((bars[r.from - 1]?.x ?? 0) + (bars[r.from]?.x ?? 0)) / 2),
    months: monthTicks(sessions, x),
  };
}

function weightRuns(sessions: SessionView[]) {
  const runs: { weight: number | null; from: number; to: number }[] = [];
  sessions.forEach((s, i) => {
    const last = runs[runs.length - 1];
    if (last && last.weight === s.topWeight) {
      last.to = i;
    } else {
      runs.push({ weight: s.topWeight, from: i, to: i });
    }
  });
  return runs;
}

/** Values to y, with a little room above and below. */
function scale(min: number, max: number, plot: Plot): (v: number) => number {
  const pad = Math.max((max - min) * 0.15, 2);
  const lo = min - pad;
  const hi = max + pad;
  const floor = plot.height - plot.bottom;
  return (v) => floor - ((v - lo) / (hi - lo)) * (floor - 8);
}

/** Dates to x across the plot; one session sits in the middle. */
function timeScale(sessions: SessionView[], plot: Plot): (date: string) => number {
  const times = sessions.map((s) => Date.parse(`${s.date}T00:00:00Z`));
  const first = Math.min(...times);
  const span = Math.max(...times) - first;
  const inner = plot.width - plot.left - 20;
  return (date) =>
    span === 0
      ? plot.left + inner / 2
      : plot.left + ((Date.parse(`${date}T00:00:00Z`) - first) / span) * inner;
}

function monthTicks(sessions: SessionView[], x: (date: string) => number) {
  const first = sessions[0]?.date ?? "";
  const last = sessions[sessions.length - 1]?.date ?? "";
  const ticks: { x: number; label: string }[] = [];
  let [year, month] = first.split("-").map(Number) as [number, number];
  month += 1;
  for (let i = 0; i < 24; i++) {
    if (month > 12) {
      month = 1;
      year += 1;
    }
    const date = `${year}-${String(month).padStart(2, "0")}-01`;
    if (date > last) {
      break;
    }
    ticks.push({ x: x(date), label: MONTHS[month - 1] ?? "" });
    month += 1;
  }
  return ticks;
}

function fix(n: number): string {
  return n.toFixed(1);
}
