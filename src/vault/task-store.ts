// Finds, adds and completes Obsidian Tasks anywhere in the vault. Tasks stay where you put them;
// the server only appends new ones to the inbox file and edits single lines in place.
import { createHash } from "node:crypto";
import { defined } from "../defined";
import { formatTask, indentOf, nextDue, parseTaskLine, type Task } from "./tasks";
import type { Vault } from "./vault";
export interface FoundTask {
  /** The task's 🆔, or a stable reference derived from its file and text when it has none. */
  ref: string;
  path: string;
  task: Task;
}
export interface NewTask {
  /** Device-generated key; the same key always maps to the same 🆔, so retries are safe. */
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

  /** Every task in the vault's Markdown files. Hidden folders (.obsidian, .trash, .cc) are skipped. */
  async list(): Promise<FoundTask[]> {
    const found: FoundTask[] = [];
    for await (const path of new Bun.Glob("**/*.md").scan({ cwd: this.vault.root })) {
      found.push(...tasksIn(path, (await this.vault.read(path)) ?? ""));
    }
    return found;
  }
  /** Append a task to the inbox, unless a task with the same 🆔 already exists anywhere. */
  async add(input: NewTask, today: string): Promise<AddResult> {
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
      created: today,
      id,
    };
    let result: AddResult = { status: "created", task: { ref: id, path: this.inboxPath, task } };
    await this.vault.update(this.inboxPath, (text) => {
      const duplicate = tasksIn(this.inboxPath, text ?? "").find((t) => t.ref === id);
      if (duplicate) {
        result = { status: "already_done", task: duplicate };
        return null;
      }
      return appendLine(text, formatTask(task));
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
      const index = lines.findIndex((line) => refOf(target.path, line) === ref);
      if (index < 0) {
        throw new Error("NOT_FOUND");
      }
      const line = defined(lines[index]);
      if (etag && shortHash(line) !== etag) {
        throw new Error("ABORTED");
      }
      const task = change(defined(parseTaskLine(line)));
      if (task) {
        task.id ??= ref;
        lines[index] = formatTask(task, indentOf(line));
        result = { ref, path: target.path, task };
      } else {
        lines.splice(index, 1);
      }
      return lines.join("\n");
    });
    return result;
  }
  async etag(target: FoundTask): Promise<string> {
    const line = ((await this.vault.read(target.path)) ?? "")
      .split("\n")
      .find((line) => refOf(target.path, line) === target.ref);
    return shortHash(line ?? "");
  }
  /**
   * Tick a task off and stamp ✅ today. A recurring task gets its next occurrence inserted above
   * it, as Tasks does. Completing an already-done task changes nothing.
   */
  async complete(ref: string, today: string, etag?: string): Promise<CompleteResult> {
    // Without a 🆔, a done task and its next occurrence share a ref, so prefer the open one.
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
      const line = (text ?? "").split("\n").find((line) => refOf(target.path, line) === ref);
      if (etag && shortHash(line ?? "") !== etag) {
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
  for (const line of text.split("\n")) {
    const task = parseTaskLine(line);
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
  const index = lines.findIndex((line) => refOf(path, line) === ref && !parseTaskLine(line)?.done);
  const line = lines[index] ?? "";
  const task = parseTaskLine(line);
  if (!task || task.done) {
    return { text: null, result: { status: "not_found" } };
  }
  const indent = indentOf(line);
  const done: Task = { ...task, done: true, completed: today };
  const next = nextOccurrence(task);
  const replacement = next
    ? [formatTask(next, indent), formatTask(done, indent)]
    : [formatTask(done, indent)];
  lines.splice(index, 1, ...replacement);
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
  return { ...task, due, id, completed: undefined, created: undefined };
}
function refOf(path: string, line: string): string | null {
  const task = parseTaskLine(line);
  return task ? (task.id ?? derivedRef(path, task)) : null;
}
/** A stable reference for a task without a 🆔, from its file and description. */
function derivedRef(path: string, task: Task): string {
  return `h${shortHash(`${path}\n${task.description}`)}`;
}
export function shortHash(value: string): string {
  return createHash("sha256").update(value).digest("hex").slice(0, 6);
}
function appendLine(text: string | null, line: string): string {
  if (!text) {
    return `${line}\n`;
  }
  return `${text.endsWith("\n") ? text : `${text}\n`}${line}\n`;
}
