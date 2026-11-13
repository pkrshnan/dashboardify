// The one-time move of tasks and habits from the old one-line forms to sub-bullet fields
// (docs/fields.md). Pure: scripts/convert-vault.ts reads and writes the files. Only lines in the
// old form change, so running it twice changes nothing.

import { HABIT_KEYS, habitLines, parseHabits } from "../habits/habit-note";
import { replaceItem } from "./fields";
import { formatTask, hasOldFields, indentOf, parseTask, TASK_KEYS } from "./tasks";

export interface Conversion {
  text: string;
  /** Each item's lines before and after, in note order. */
  changes: { before: string[]; after: string[] }[];
}

/** Every task in the note written the old way, rewritten. */
export function convertTasks(text: string): Conversion {
  const lines = text.split("\n");
  const changes: Conversion["changes"] = [];
  // Bottom up, so a rewrite doesn't move the lines still to come.
  for (let index = lines.length - 1; index >= 0; index--) {
    const line = lines[index] ?? "";
    const task = hasOldFields(line) ? parseTask(lines, index) : null;
    if (task) {
      const after = formatTask(task, indentOf(line));
      changes.unshift({ before: [line], after });
      replaceItem(lines, index, TASK_KEYS, after);
    }
  }
  return { text: lines.join("\n"), changes };
}

/** Every habit in Habits.md with `·` fields on its line, rewritten. */
export function convertHabits(text: string): Conversion {
  const lines = text.split("\n");
  const changes: Conversion["changes"] = [];
  for (const habit of parseHabits(text).reverse()) {
    const line = lines[habit.line] ?? "";
    if (line.replace(/<!--.*-->/, "").includes("·")) {
      const after = habitLines(habit);
      changes.unshift({ before: [line], after });
      replaceItem(lines, habit.line, HABIT_KEYS, after);
    }
  }
  return { text: lines.join("\n"), changes };
}
