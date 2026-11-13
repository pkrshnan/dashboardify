// Finds, adds and completes tasks: every checkbox in the inbox note, and elsewhere those with a
// due date or an id, so a trip's packing list stays a note. Tasks stay where you put them; the
// server only appends new ones to the inbox file and edits a task's line and fields in place.
import { createHash } from "node:crypto";
import { defined } from "../defined";
import { LISTS_FOLDER } from "../lists/list-store";
import { fieldLines, replaceItem } from "./fields";
import { formatTask, indentOf, nextDue, parseTask, TASK_KEYS, type Task } from "./tasks";
import type { Vault } from "./vault";
export interface FoundTask {
  /** The task's id, or a stable reference derived from its file and text when it has none. */
  ref: string;
  path: string;
  task: Task;
}
export interface NewTask {
  /** Device-generated key; the same key always maps to the same id, so retries are safe. */
  key: string;
  description: string;
  due?: string;
  time?: string;
  priority?: Task["priority"];
  recurrence?: string;
}
export type AddResult = {
  status: "created" | "already_done";
  task: FoundTask;
};
export type CompleteResult =
  | {
      status: "completed";
      task: FoundTask;
      next?: Task;
      recurrenceUnsupported?: boolean;
    }
  | {
      status: "already_done";
      task: FoundTask;
    }
  | {
      status: "not_found";
    };
export class TaskStore {
  /** `inbox` may be a function, so a change in Settings applies to the next new task. */
  constructor(
    private readonly vault: Vault,
    private readonly inbox: string | (() => string),
  ) {}

  get inboxPath(): string {
    return typeof this.inbox === "string" ? this.inbox : this.inbox();
  }

  /**
   * Every task in the vault's Markdown files: all of the inbox's checkboxes, and elsewhere those
   * with a due date or an id. Hidden folders (.obsidian, .trash, .cc) are skipped, and so is
   * Lists/: a list's `- [ ]` lines are list items, not tasks.
   */
  async list(): Promise<FoundTask[]> {
    const found: FoundTask[] = [];
    const inbox = this.inboxPath;
    for await (const path of new Bun.Glob("**/*.md").scan({ cwd: this.vault.root })) {
      if (path.startsWith(`${LISTS_FOLDER}/`)) {
        continue;
      }
      const tasks = tasksIn(path, (await this.vault.read(path)) ?? "");
      found.push(...(path === inbox ? tasks : tasks.filter(({ task }) => task.due || task.id)));
    }
    return found;
  }
  /** Append a task to the inbox, unless a task with the same id already exists anywhere. */
  async add(input: NewTask): Promise<AddResult> {
    const id = shortHash(input.key);
    const existing = (await this.list()).find((t) => t.task.id === id);
    if (existing) {
      return { status: "already_done", task: existing };
    }
    const task: Task = {
      done: false,
      description: input.description,
      time: input.time,
      priority: input.priority,
      recurrence: input.recurrence,
      due: input.due,
      id,
    };
    let result: AddResult = { status: "created", task: { ref: id, path: this.inboxPath, task } };
    await this.vault.update(this.inboxPath, (text) => {
      const duplicate = tasksIn(this.inboxPath, text ?? "").find((t) => t.ref === id);
      if (duplicate) {
        result = { status: "already_done", task: duplicate };
        return null;
      }
      return appendLines(text, formatTask(task));
    });
    return result;
  }
  async edit(
    ref: string,
    etag: string | undefined,
    change: (task: Task) => Task | null,
  ): Promise<FoundTask | null> {
    const target = (await this.list()).find((t) => t.ref === ref);
    if (!target) {
      throw new Error("NOT_FOUND");
    }
    let result: FoundTask | null = null;
    await this.vault.update(target.path, (text) => {
      const lines = (text ?? "").split("\n");
      const index = indexOf(lines, target.path, ref);
      if (index < 0) {
        throw new Error("NOT_FOUND");
      }
      if (etag && etagAt(lines, index) !== etag) {
        throw new Error("ABORTED");
      }
      const task = change(defined(parseTask(lines, index)));
      if (task) {
        task.id ??= ref;
        result = { ref, path: target.path, task };
      }
      const indent = indentOf(defined(lines[index]));
      replaceItem(lines, index, TASK_KEYS, task ? formatTask(task, indent) : []);
      return lines.join("\n");
    });
    return result;
  }
  async etag(target: FoundTask): Promise<string> {
    const lines = ((await this.vault.read(target.path)) ?? "").split("\n");
    return etagAt(lines, indexOf(lines, target.path, target.ref));
  }
  /**
   * Tick a task off and stamp `done:` today. A recurring task gets its next occurrence inserted above
   * it, as Tasks does. Completing an already-done task changes nothing.
   */
  async complete(ref: string, today: string, etag?: string): Promise<CompleteResult> {
    // Without an id, a done task and its next occurrence share a ref, so prefer the open one.
    const matches = (await this.list()).filter((t) => t.ref === ref);
    const target = matches.find((t) => !t.task.done) ?? matches[0];
    if (!target) {
      return { status: "not_found" };
    }
    if (target.task.done) {
      if (etag && (await this.etag(target)) !== etag) {
        throw new Error("ABORTED");
      }
      return { status: "already_done", task: target };
    }
    let result: CompleteResult = { status: "not_found" };
    await this.vault.update(target.path, (text) => {
      const lines = (text ?? "").split("\n");
      if (etag && etagAt(lines, indexOf(lines, target.path, ref)) !== etag) {
        throw new Error("ABORTED");
      }
      const edit = completeIn(text ?? "", target.path, ref, today);
      result = edit.result;
      return edit.text;
    });
    return result;
  }
}
function tasksIn(path: string, text: string): FoundTask[] {
  const found: FoundTask[] = [];
  const lines = text.split("\n");
  for (const index of lines.keys()) {
    const task = parseTask(lines, index);
    if (task) {
      found.push({ ref: task.id ?? derivedRef(path, task), path, task });
    }
  }
  return found;
}
/** Tick off the line for `ref` inside `text`. Returns null text when nothing should be written. */
function completeIn(
  text: string,
  path: string,
  ref: string,
  today: string,
): {
  text: string | null;
  result: CompleteResult;
} {
  const lines = text.split("\n");
  const index = indexOf(lines, path, ref, (task) => !task.done);
  const task = index < 0 ? null : parseTask(lines, index);
  if (!task || task.done) {
    return { text: null, result: { status: "not_found" } };
  }
  const indent = indentOf(lines[index] ?? "");
  const done: Task = { ...task, done: true, completed: today };
  const next = nextOccurrence(task);
  const replacement = next
    ? [...formatTask(next, indent), ...formatTask(done, indent)]
    : formatTask(done, indent);
  replaceItem(lines, index, TASK_KEYS, replacement);
  return {
    text: lines.join("\n"),
    result: {
      status: "completed",
      task: { ref, path, task: done },
      next: next ?? undefined,
      recurrenceUnsupported: Boolean(task.recurrence) && !next,
    },
  };
}
function nextOccurrence(task: Task): Task | null {
  if (!(task.recurrence && task.due)) {
    return null;
  }
  const due = nextDue(task.recurrence, task.due);
  if (!due) {
    return null;
  }
  const id = task.id ? shortHash(`${task.id}:${due}`) : undefined;
  return { ...task, due, id, completed: undefined };
}
/** The line of the first task with `ref` that passes `filter`, or -1. */
function indexOf(
  lines: string[],
  path: string,
  ref: string,
  filter: (task: Task) => boolean = () => true,
): number {
  return lines.findIndex((_, index) => {
    const task = parseTask(lines, index);
    return task !== null && (task.id ?? derivedRef(path, task)) === ref && filter(task);
  });
}
/** A hash of the task's line and its fields, so an edit to either makes an older etag stale. */
function etagAt(lines: string[], index: number): string {
  const own = [index, ...(index < 0 ? [] : fieldLines(lines, index, TASK_KEYS))];
  return shortHash(own.map((i) => lines[i] ?? "").join("\n"));
}
/** A stable reference for a task without an id, from its file and description. */
function derivedRef(path: string, task: Task): string {
  return `h${shortHash(`${path}\n${task.description}`)}`;
}
export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}
function appendLines(text: string | null, lines: string[]): string {
  const block = `${lines.join("\n")}\n`;
  if (!text) {
    return block;
  }
  return `${text.endsWith("\n") ? text : `${text}\n`}${block}`;
}
