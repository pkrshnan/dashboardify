// The vault is the source of truth. Every write goes through this module,
// which only ever builds paths from validated dates and fixed folder names.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { appendToSection, mergeFrontmatter, parseNote, renderNote, type Note } from "./markdown";
import { localDate, localTime } from "./time";

export type HealthMetrics = Record<string, number>;

export interface Reminder {
  id: string;
  title: string;
  list?: string;
  due?: string; // YYYY-MM-DD
  completed?: boolean;
}

export interface IncomingMessage {
  id?: string;
  sender: string;
  text: string;
  receivedAt: Date;
}

export class Vault {
  private locks = new Map<string, Promise<unknown>>();

  constructor(
    readonly root: string,
    readonly timeZone: string,
  ) {}

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

  readonly remindersPath = "tasks/reminders.md";

  // ---- low-level IO ------------------------------------------------------

  async read(rel: string): Promise<string | null> {
    try {
      return await readFile(join(this.root, rel), "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw err;
    }
  }

  /** Atomic write: temp file + rename, so Obsidian or sync never sees half a file. */
  private async write(rel: string, text: string): Promise<void> {
    const abs = join(this.root, rel);
    await mkdir(dirname(abs), { recursive: true });
    const tmp = `${abs}.${process.pid}.${Date.now()}.tmp`;
    await writeFile(tmp, text, "utf8");
    await rename(tmp, abs);
  }

  /** Serialise read-modify-write cycles per file within this process. */
  private async update(rel: string, fn: (current: string | null) => string): Promise<string> {
    const prev = this.locks.get(rel) ?? Promise.resolve();
    const run = prev.then(async () => {
      const next = fn(await this.read(rel));
      await this.write(rel, next);
      return next;
    });
    const settled = run.catch(() => undefined);
    this.locks.set(rel, settled);
    settled.then(() => {
      if (this.locks.get(rel) === settled) this.locks.delete(rel);
    });
    return run;
  }

  // ---- daily notes -------------------------------------------------------

  private newDaily(date: string): Note {
    return { frontmatter: { date, tags: ["daily"] }, body: `# ${date}\n\n## Journal\n` };
  }

  private updateDaily(date: string, fn: (note: Note) => Note): Promise<string> {
    return this.update(this.dailyPath(date), (text) =>
      renderNote(fn(text === null ? this.newDaily(date) : parseNote(text))),
    );
  }

  async readDaily(date: string): Promise<Note | null> {
    const text = await this.read(this.dailyPath(date));
    return text === null ? null : parseNote(text);
  }

  async appendJournal(at: Date, text: string): Promise<{ path: string }> {
    const date = localDate(at, this.timeZone);
    const time = localTime(at, this.timeZone);
    const [first, ...rest] = text.trim().split(/\r?\n/);
    const line = [`- ${time} ${first}`, ...rest.map((l) => `  ${l}`)].join("\n");
    await this.updateDaily(date, (note) => ({ ...note, body: appendToSection(note.body, "Journal", line) }));
    return { path: this.dailyPath(date) };
  }

  // ---- health ------------------------------------------------------------

  async recordHealth(date: string, metrics: HealthMetrics, source: string): Promise<{ paths: string[] }> {
    await this.updateDaily(date, (note) => mergeFrontmatter(note, metrics));
    const csv = this.healthCsvPath(date);
    await this.update(csv, (text) => upsertCsvRow(text, date, metrics, source));
    return { paths: [this.dailyPath(date), csv] };
  }

  // ---- reminders (read-only mirror) --------------------------------------

  async mirrorReminders(items: Reminder[], at: Date): Promise<{ path: string; count: number }> {
    const byList = new Map<string, Reminder[]>();
    for (const item of items) {
      const list = item.list?.trim() || "Reminders";
      byList.set(list, [...(byList.get(list) ?? []), item]);
    }
    const sections = [...byList.keys()].sort().map((list) => {
      const lines = byList
        .get(list)!
        .sort((a, b) => Number(a.completed ?? false) - Number(b.completed ?? false) || (a.due ?? "~").localeCompare(b.due ?? "~"))
        .map((r) => `- [${r.completed ? "x" : " "}] ${oneLine(r.title)}${r.due ? ` 📅 ${r.due}` : ""} <!-- id:${oneLine(r.id)} -->`);
      return `## ${oneLine(list)}\n\n${lines.join("\n")}`;
    });
    const note: Note = {
      frontmatter: { source: "apple-reminders", synced_at: at.toISOString() },
      body:
        "# Reminders\n\n> Mirrored from Apple Reminders. This file is rewritten on every sync, so make changes in Reminders.\n\n" +
        (sections.length ? sections.join("\n\n") + "\n" : "_No open reminders._\n"),
    };
    await this.update(this.remindersPath, () => renderNote(note));
    return { path: this.remindersPath, count: items.length };
  }

  // ---- messages ----------------------------------------------------------

  async appendMessage(msg: IncomingMessage): Promise<{ path: string; duplicate: boolean }> {
    const date = localDate(msg.receivedAt, this.timeZone);
    const time = localTime(msg.receivedAt, this.timeZone);
    const path = this.messagesPath(date);
    const marker = msg.id ? ` <!-- id:${oneLine(msg.id)} -->` : "";
    let duplicate = false;
    await this.update(path, (text) => {
      if (marker && text?.includes(marker)) {
        duplicate = true;
        return text;
      }
      const note: Note =
        text === null
          ? { frontmatter: { date, source: "ios-shortcut", privacy: "local-only", tags: ["messages"] }, body: `# Messages ${date}\n` }
          : parseNote(text);
      const line = `- ${time} **${escapeMd(oneLine(msg.sender))}**: ${oneLine(msg.text)}${marker}`;
      return renderNote({ ...note, body: appendToSection(note.body, "Received", line) });
    });
    return { path, duplicate };
  }
}

// ---- helpers -------------------------------------------------------------

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").replace(/<!--|-->/g, "").trim();
}

function escapeMd(s: string): string {
  return s.replace(/([*_`\[\]])/g, "\\$1");
}

/** Insert or replace the row for `date`. Columns: date, then metrics sorted, then source. */
export function upsertCsvRow(text: string | null, date: string, metrics: HealthMetrics, source: string): string {
  const rows = new Map<string, Record<string, string>>();
  const columns = new Set<string>();
  if (text) {
    const [header, ...lines] = text.trim().split("\n");
    const cols = (header ?? "").split(",");
    for (const line of lines) {
      const cells = line.split(",");
      const row: Record<string, string> = {};
      cols.forEach((c, i) => (row[c] = cells[i] ?? ""));
      if (row.date) rows.set(row.date, row);
    }
    cols.forEach((c) => columns.add(c));
  }
  const existing = rows.get(date) ?? {};
  const row: Record<string, string> = { ...existing, date, source };
  for (const [k, v] of Object.entries(metrics)) row[k] = String(v);
  rows.set(date, row);
  Object.keys(row).forEach((c) => columns.add(c));

  const metricCols = [...columns].filter((c) => c !== "date" && c !== "source").sort();
  const header = ["date", ...metricCols, "source"];
  const body = [...rows.keys()].sort().map((d) => header.map((c) => rows.get(d)![c] ?? "").join(","));
  return [header.join(","), ...body].join("\n") + "\n";
}
