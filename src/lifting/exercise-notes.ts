// One note per exercise in the vault's Lifting/ folder. You own the note; the server reads its
// title, `aliases`, `reps` and `step`, and rewrites only the `cc:lifting` history block (and
// `reps`/`step` when you change them on the page). docs/lifting.md has the format.

import type { WeightUnit } from "../vault/lifting";
import type { Frontmatter } from "../vault/markdown";
import type { SessionHeartRate } from "./heart-rate";
import type { ExerciseHistory, Progress, Session, WorkSet } from "./history";
import { groupsText, round, setRuns } from "./log-edit";
import { exerciseKey } from "./names";
import { defaultRange, type NextTime, type RepRange } from "./next-time";

export const LIFTING_FOLDER = "Lifting";
export const HISTORY_BLOCK = "lifting";

export interface ExerciseNote {
  path: string;
  /** The file name. */
  title: string;
  aliases: string[];
  /** `reps: 8-12`; null when the note doesn't say. */
  reps: { low: number; high: number } | null;
  step: number | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PROGRESS: Record<Progress, string> = {
  weight: "↑ weight",
  reps: "↑ reps",
  same: "=",
  down: "↓",
};

export function readExerciseNote(path: string, frontmatter: Frontmatter): ExerciseNote {
  const title = path.slice(LIFTING_FOLDER.length + 1, -".md".length);
  const aliases = Array.isArray(frontmatter.aliases) ? frontmatter.aliases.map(String) : [];
  const step = Number(frontmatter.step);
  return {
    path,
    title,
    aliases,
    reps: repRange(frontmatter.reps),
    step: Number.isFinite(step) && step > 0 ? step : null,
  };
}

function repRange(value: unknown): { low: number; high: number } | null {
  const match = /^\s*(\d+)\s*[-–]\s*(\d+)\s*$/.exec(String(value ?? ""));
  const low = Number(match?.[1]);
  const high = Number(match?.[2]);
  return match && low > 0 && high >= low ? { low, high } : null;
}

/** Each note's title and aliases, by name key, to the note's title. */
export function titlesOf(notes: ExerciseNote[]): Map<string, string> {
  const titles = new Map<string, string>();
  for (const note of notes) {
    for (const name of [note.title, ...note.aliases]) {
      titles.set(exerciseKey(name), note.title);
    }
  }
  return titles;
}

/** The note's range, filling in the defaults for the exercise's unit. */
export function rangeOf(note: ExerciseNote | undefined, unit: WeightUnit): RepRange {
  const fallback = defaultRange(unit);
  return { ...fallback, ...(note?.reps ?? {}), step: note?.step ?? fallback.step };
}

/** A title that is safe as a file name in Obsidian. */
export function fileTitle(title: string): string {
  return title.replace(/[\\/:*?"<>|#^[\]]/g, "").trim() || "Exercise";
}

/** The `cc:lifting` block: next time, records, and every session, newest first. */
export function historyBlock(
  history: ExerciseHistory,
  next: NextTime | null,
  heartRate: (date: string) => SessionHeartRate | null,
): string {
  const unit = history.unit;
  const rows = [...history.sessions].reverse().map((s) => sessionRow(s, unit, heartRate(s.date)));
  return [
    "## History",
    ...(next ? [`Next: ${setsText(next.sets, unit)}`] : []),
    `Records: ${recordsText(history)}`,
    "",
    "| Day | Sets | Est. 1RM | Rest | Peak HR | |",
    "| --- | --- | --- | --- | --- | --- |",
    ...rows,
  ].join("\n");
}

function sessionRow(s: Session, unit: WeightUnit, hr: SessionHeartRate | null): string {
  const cells = [
    `[[${s.date}]]`,
    setsText(s.sets, unit),
    s.est1rm === null ? "" : String(Math.round(s.est1rm)),
    hr?.restSeconds == null ? "" : minutes(hr.restSeconds),
    hr?.peakHr == null ? "" : String(hr.peakHr),
    s.progress === null ? "" : PROGRESS[s.progress],
  ];
  return `| ${cells.join(" | ")} |`;
}

/** `60 lb, 1x10 W · 80 lb, 3x10` */
export function setsText(sets: WorkSet[], unit: WeightUnit): string {
  return setRuns(sets)
    .map((run) => {
      const groups = `${groupsText(run)}${run.warmUp ? " W" : ""}`;
      return run.weight === null ? groups : `${round(run.weight)} ${unit}, ${groups}`;
    })
    .join(" · ");
}

function recordsText(history: ExerciseHistory): string {
  const { heaviest, est1rm, atTop } = history.records;
  const unit = history.unit;
  const parts = [
    ...(heaviest ? [`${round(heaviest.value)} ${unit} top`] : []),
    ...(est1rm ? [`est. 1RM ${Math.round(est1rm.value)}`] : []),
  ];
  const last = history.sessions[history.sessions.length - 1];
  if (atTop && last) {
    const sets = atTop.value.map((reps) => ({ weight: last.topWeight, reps, warmUp: false }));
    parts.push(`${setsText(sets, unit)} on ${dayMonth(atTop.date)}`);
  }
  return parts.join(" · ");
}

/** "2026-11-08" → "8 Nov" */
export function dayMonth(date: string): string {
  const [, month, day] = date.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]}`;
}

function minutes(seconds: number): string {
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
