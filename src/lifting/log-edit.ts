// Writing the log screen's sets into a daily note's `## Workouts`, in the form you type them. The
// server rewrites only the load lines of the exercise it was sent; other exercises, notes under
// it and the rest of the note are kept. docs/lifting.md and docs/vault-format.md have the format.

import { isLoadLine, LIFTING_SECTION, type WeightUnit } from "../vault/lifting";
import type { WorkSet } from "./history";
import { exerciseKey } from "./names";

const BULLET = /^(\s*)([-*+])\s+(.*)$/;
const HEADING = /^#{1,2} /;

interface Style {
  bullet: string;
  indent: string;
}

/** Consecutive sets at one weight share a line: `80lbs, 2x11, 1x10`, `7.5lbs, 1x10, warm-up`. */
export function loadLines(sets: WorkSet[], unit: WeightUnit): string[] {
  const runs: WorkSet[][] = [];
  for (const set of sets) {
    const run = runs[runs.length - 1];
    const first = run?.[0];
    if (run && first && first.weight === set.weight && first.warmUp === set.warmUp) {
      run.push(set);
    } else {
      runs.push([set]);
    }
  }
  return runs.map((run) => loadLine(run, unit));
}

function loadLine(run: WorkSet[], unit: WeightUnit): string {
  const groups: { count: number; reps: number }[] = [];
  for (const set of run) {
    const group = groups[groups.length - 1];
    if (group?.reps === set.reps) {
      group.count++;
    } else {
      groups.push({ count: 1, reps: set.reps });
    }
  }
  const weight = run[0]?.weight ?? null;
  const parts = [
    ...(weight === null ? [] : [`${Number(weight.toFixed(2))}${unit === "kg" ? "kg" : "lbs"}`]),
    ...groups.map((g) => `${g.count}x${g.reps}`),
    ...(run[0]?.warmUp ? ["warm-up"] : []),
  ];
  return parts.join(", ");
}

/** Sets `title`'s load lines in `body`, adding the exercise, or the section, when missing. */
export function replaceExercise(
  body: string,
  title: string,
  unit: WeightUnit,
  sets: WorkSet[],
): string {
  const lines = body.split("\n");
  const section = findSection(lines);
  if (!section) {
    return addSection(lines, title, loadLines(sets, unit));
  }
  const style = styleOf(lines.slice(section.start + 1, section.end));
  const loads = loadLines(sets, unit).map((l) => `${style.indent}${style.bullet} ${l}`);
  const block = findExercise(lines, section, title);
  if (!block) {
    const at = lastContent(lines, section);
    lines.splice(at, 0, `${style.bullet} ${title}`, ...loads);
    return lines.join("\n");
  }
  const inside = lines.slice(block.start + 1, block.end);
  const firstLoad = inside.findIndex(isLoad);
  const notes = inside.filter((l) => !isLoad(l));
  const at = firstLoad === -1 ? 0 : firstLoad;
  const kept = [...notes.slice(0, at), ...loads, ...notes.slice(at)];
  lines.splice(block.start + 1, inside.length, ...kept);
  return lines.join("\n");
}

/** Takes `title` and everything indented under it out of `body`; unchanged when it isn't there. */
export function removeExercise(body: string, title: string): string {
  const lines = body.split("\n");
  const section = findSection(lines);
  const block = section ? findExercise(lines, section, title) : null;
  if (!block) {
    return body;
  }
  lines.splice(block.start, block.end - block.start);
  return lines.join("\n");
}

interface Span {
  start: number;
  end: number;
}

function findSection(lines: string[]): Span | null {
  const start = lines.findIndex((l) => l.trim() === `## ${LIFTING_SECTION}`);
  if (start === -1) {
    return null;
  }
  const next = lines.findIndex((l, i) => i > start && HEADING.test(l));
  return { start, end: next === -1 ? lines.length : next };
}

/** The exercise's bullet and the indented lines under it. */
function findExercise(lines: string[], section: Span, title: string): Span | null {
  const key = exerciseKey(title);
  for (let i = section.start + 1; i < section.end; i++) {
    if (exerciseName(lines[i] ?? "") === key) {
      let end = i + 1;
      while (end < section.end && isIndented(lines[end] ?? "")) {
        end++;
      }
      return { start: i, end };
    }
  }
  return null;
}

/** The key of a top-level exercise bullet; null for anything else. */
function exerciseName(line: string): string | null {
  const bullet = BULLET.exec(line);
  const text = bullet?.[3] ?? "";
  return bullet && bullet[1] === "" && !isLoadLine(text) ? exerciseKey(text) : null;
}

function isIndented(line: string): boolean {
  return line.trim() !== "" && /^\s/.test(line);
}

function isLoad(line: string): boolean {
  const bullet = BULLET.exec(line);
  return bullet !== null && bullet[1] !== "" && isLoadLine(bullet[3] ?? "");
}

/** The section's bullet and indent, so new lines look like the ones you typed. */
function styleOf(lines: string[]): Style {
  const top = lines.map((l) => BULLET.exec(l)).find((b) => b && b[1] === "");
  const sub = lines.map((l) => BULLET.exec(l)).find((b) => b && (b[1] ?? "") !== "");
  return { bullet: top?.[2] ?? sub?.[2] ?? "-", indent: sub?.[1] ?? "    " };
}

/** Just after the section's last non-blank line. */
function lastContent(lines: string[], section: Span): number {
  let at = section.end;
  while (at > section.start + 1 && (lines[at - 1] ?? "").trim() === "") {
    at--;
  }
  return at;
}

/** A new `## Workouts`, before `## Journal` as in your notes, or at the end. */
function addSection(lines: string[], title: string, loads: string[]): string {
  const block = [`## ${LIFTING_SECTION}`, `- ${title}`, ...loads.map((l) => `    - ${l}`), ""];
  const journal = lines.findIndex((l) => l.trim() === "## Journal");
  if (journal !== -1) {
    lines.splice(journal, 0, ...block);
    return lines.join("\n");
  }
  const trimmed = lines.join("\n").replace(/\n*$/, "");
  return `${trimmed === "" ? "" : `${trimmed}\n\n`}${block.join("\n")}`;
}
