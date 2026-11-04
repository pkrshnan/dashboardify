// The vault is the source of truth. Every write goes through this module, which only
// ever builds paths from validated dates and fixed folder names.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Mutex } from "async-mutex";
import { upsertCsvRow } from "./csv";
import {
  appendToSection,
  editNote,
  type Frontmatter,
  mergeFrontmatter,
  type Note,
  parseNote,
  replaceBlockAtTop,
} from "./markdown";
import { localDate, localTime } from "./time";

export type HealthMetrics = Record<string, number>;

/** A check-in's answers. Each is optional; only the ones given are written. */
export interface Checkin {
  /** How you feel this morning, 1 (awful) to 5 (great). */
  feel?: number;
  /** How hard a workout felt, 0 (rest) to 10 (maximal). */
  rpe?: number;
  /** What might explain the night: alcohol, sick, stressed, … */
  tags?: string[];
}

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

  /**
   * Store a morning check-in (how you feel, workout effort, tags) in the daily note's
   * frontmatter. Tags are added to any already there; other fields replace earlier answers.
   */
  async recordCheckin(date: string, checkin: Checkin): Promise<{ path: string }> {
    await this.updateDaily(date, (note) => {
      const earlier = note.frontmatter.health_tags;
      const kept = Array.isArray(earlier) ? earlier.filter((t) => typeof t === "string") : [];
      const tags = checkin.tags ? [...new Set([...kept, ...checkin.tags])] : undefined;
      return mergeFrontmatter(note, {
        feel: checkin.feel,
        effort_rpe: checkin.rpe,
        health_tags: tags,
      });
    });
    return { path: this.dailyPath(date) };
  }

  /** Replace the daily note's `<!-- cc:name -->` region, placing it under the title if new. */
  async setDailyBlock(date: string, name: string, content: string): Promise<boolean> {
    return this.updateDaily(date, (note) => ({
      ...note,
      body: replaceBlockAtTop(note.body, name, content),
    }));
  }

  /** profile.md's frontmatter (birth date, sex, height, …), or null without a profile. */
  async readProfile(): Promise<Frontmatter | null> {
    const text = await this.read("profile.md");
    return text === null ? null : parseNote(text).frontmatter;
  }

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
    .replace(/\s+/g, " ")
    .replace(/<!--|-->/g, "")
    .trim();
}

function escapeMd(s: string): string {
  return s.replace(/([*_`[\]])/g, "\\$1");
}
