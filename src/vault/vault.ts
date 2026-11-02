// The vault is the source of truth. Every write goes through this module, which only
// ever builds paths from validated dates and fixed folder names.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Mutex } from "async-mutex";
import { upsertCsvRow } from "./csv";
import { appendToSection, editNote, mergeFrontmatter, type Note, parseNote } from "./markdown";
<<<<<<< HEAD
import {
  applySync,
  parseReminders,
  type Reminder,
  type ReminderDiff,
  renderReminders,
} from "./reminders";
=======
>>>>>>> origin/main
import { localDate, localTime } from "./time";

export type HealthMetrics = Record<string, number>;

export interface IncomingMessage {
  id?: string;
  sender: string;
  text: string;
  receivedAt: Date;
}

/** Called after every successful write with the vault-relative path. Used by git sync. */
export type WriteListener = (path: string) => void;

export class Vault {
  /** One lock per file, so read-modify-write cycles on the same file never interleave. */
  private locks = new Map<string, Mutex>();
  private listeners: WriteListener[] = [];

  constructor(
    readonly root: string,
    readonly timeZone: string,
  ) {}

  onWrite(listener: WriteListener): void {
    this.listeners.push(listener);
  }

  // ---- paths -------------------------------------------------------------

  dailyPath(date: string): string {
    return `daily/${date.slice(0, 4)}/${date}.md`;
  }

  healthCsvPath(date: string): string {
    return `health/${date.slice(0, 4)}/${date.slice(0, 7)}.csv`;
  }

  messagesPath(date: string): string {
    return `inbox/messages/${date}.md`;
  }

<<<<<<< HEAD
  readonly remindersPath = "tasks/reminders.md";

  /** Server state that is not part of your notes. Lives in `.cc/`, which is never synced. */
  private statePath(name: string): string {
    return `.cc/state/${name}.json`;
  }

=======
>>>>>>> origin/main
  // ---- low-level IO ------------------------------------------------------

  async read(rel: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, rel), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return null;
      }
      throw err;
    }
  }

  /** Atomic write: temp file + rename, so Obsidian or git never sees half a file. */
  private async write(rel: string, text: string): Promise<void> {
    const abs = join(this.root, rel);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, abs);
  }

  /**
   * Read-modify-write one file. `edit` returns the new text, or `null` to leave the file as it
   * is. Updates to the same file run one at a time. Resolves to whether the file changed.
   */
  update(rel: string, edit: (current: string | null) => string | null): Promise<boolean> {
    return this.lockFor(rel).runExclusive(async () => {
      const current = await this.read(rel);
      const next = edit(current);
      if (next === null || next === current) {
        return false;
      }
      await this.write(rel, next);
      for (const listener of this.listeners) {
        listener(rel);
      }
      return true;
    });
  }

  private lockFor(rel: string): Mutex {
    let lock = this.locks.get(rel);
    if (!lock) {
      lock = new Mutex();
      this.locks.set(rel, lock);
    }
    return lock;
  }

  // ---- daily notes -------------------------------------------------------

  private newDaily(date: string): Note {
    return { frontmatter: { date, tags: ["daily"] }, body: `# ${date}\n\n## Journal\n` };
  }

  private updateDaily(date: string, fn: (note: Note) => Note): Promise<boolean> {
    return this.update(this.dailyPath(date), (text) => editNote(text, this.newDaily(date), fn));
  }

  async readDaily(date: string): Promise<Note | null> {
    const text = await this.read(this.dailyPath(date));
    return text === null ? null : parseNote(text);
  }

  /** Append a timestamped line to `## Journal` in the note for the day `at` falls on. */
  async appendJournal(at: Date, text: string): Promise<{ path: string }> {
    const date = localDate(at, this.timeZone);
    const time = localTime(at, this.timeZone);
    const [first, ...rest] = text.trim().split(/\r?\n/);
    const line = [`- ${time} ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
    await this.updateDaily(date, (note) => ({
      ...note,
      body: appendToSection(note.body, "Journal", line),
    }));
    return { path: this.dailyPath(date) };
  }

  // ---- health ------------------------------------------------------------

  /** Merge metrics into the daily note's frontmatter and that day's row in the monthly CSV. */
  async recordHealth(
    date: string,
    metrics: HealthMetrics,
    source: string,
  ): Promise<{ paths: string[] }> {
    await this.updateDaily(date, (note) => mergeFrontmatter(note, metrics));
    const csv = this.healthCsvPath(date);
    await this.update(csv, (text) => upsertCsvRow(text, date, metrics, source));
    return { paths: [this.dailyPath(date), csv] };
  }

<<<<<<< HEAD
  // ---- reminders ---------------------------------------------------------

  /**
   * Mirror Apple Reminders into `tasks/reminders.md`, matching by ID. The file is only
   * rewritten when the rendered result differs, and the sync time is recorded either way.
   */
  async syncReminders(
    mode: "full" | "changes",
    upserts: Reminder[],
    removedIds: string[],
    at: Date,
  ): Promise<{ path: string; changed: boolean; diff: ReminderDiff }> {
    let diff: ReminderDiff = { added: [], updated: [], removed: [] };
    const clean = upserts.map((r) => ({
      ...r,
      id: oneLine(r.id),
      title: oneLine(r.title),
      list: oneLine(r.list) || "Reminders",
    }));
    const removed = removedIds.map(oneLine);
    const changed = await this.update(this.remindersPath, (text) => {
      const result = applySync(parseReminders(text), mode, clean, removed);
      diff = result.diff;
      return renderReminders(result.next.values());
    });
    await this.writeState("reminders", { last_sync: at.toISOString(), last_mode: mode });
    return { path: this.remindersPath, changed, diff };
  }

  async readState(name: string): Promise<Record<string, unknown> | null> {
    const text = await this.read(this.statePath(name));
    return text === null ? null : JSON.parse(text);
  }

  private async writeState(name: string, value: Record<string, unknown>): Promise<void> {
    await this.write(this.statePath(name), `${JSON.stringify(value, null, 2)}\n`);
  }

=======
>>>>>>> origin/main
  // ---- messages ----------------------------------------------------------

  /** Append to the day's local-only messages file. A repeated `id` is ignored. */
  async appendMessage(msg: IncomingMessage): Promise<{ path: string; duplicate: boolean }> {
    const date = localDate(msg.receivedAt, this.timeZone);
    const time = localTime(msg.receivedAt, this.timeZone);
    const path = this.messagesPath(date);
    const marker = msg.id ? ` <!-- id:${oneLine(msg.id)} -->` : "";
    let duplicate = false;
    await this.update(path, (text) => {
      if (marker && text?.includes(marker)) {
        duplicate = true;
        return null;
      }
      const line = `- ${time} **${escapeMd(oneLine(msg.sender))}**: ${oneLine(msg.text)}${marker}`;
      return editNote(text, newMessagesNote(date), (note) => ({
        ...note,
        body: appendToSection(note.body, "Received", line),
      }));
    });
    return { path, duplicate };
  }
}

function newMessagesNote(date: string): Note {
  return {
    frontmatter: { date, source: "ios-shortcut", privacy: "local-only", tags: ["messages"] },
    body: `# Messages ${date}\n`,
  };
}

/** Collapse whitespace and strip comment markers so user text can't break the file structure. */
export function oneLine(s: string): string {
  return s
<<<<<<< HEAD
    .replace(/<!--|-->/g, "")
    .replace(/\s+/g, " ")
=======
    .replace(/\s+/g, " ")
    .replace(/<!--|-->/g, "")
>>>>>>> origin/main
    .trim();
}

function escapeMd(s: string): string {
  return s.replace(/([*_`[\]])/g, "\\$1");
}
