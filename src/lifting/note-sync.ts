// Keeps Lifting/<Title>.md in step with the daily notes: at start, every five minutes (Obsidian
// edits arrive as plain file changes), and soon after the server writes a daily note.

import type { DerivedRow } from "../health/derived-store";
import { editNote, mergeFrontmatter, parseNote, replaceBlock } from "../vault/markdown";
import type { Vault } from "../vault/vault";
import {
  type ExerciseNote,
  fileTitle,
  HISTORY_BLOCK,
  historyBlock,
  LIFTING_FOLDER,
  rangeOf,
  readExerciseNote,
  titlesOf,
} from "./exercise-notes";
import { type SessionHeartRate, sessionHeartRate } from "./heart-rate";
import type { ExerciseHistory } from "./history";
import type { LiftingStore } from "./lifting-store";
import { exerciseKey } from "./names";
import { nextTime, type RepRange } from "./next-time";

/** The exercise's note has frontmatter the server can't read, so it won't write to it. */
export class UnreadableNote extends Error {}

const EVERY_MS = 5 * 60_000;
/** Saving set after set from the log screen rebuilds the notes once. */
const SETTLE_MS = 5_000;

export interface NoteSyncDeps {
  vault: Vault;
  lifting: LiftingStore;
  /** The day's sets matched to HR climbs. */
  setsOn: (date: string) => Promise<DerivedRow[]>;
  today: () => string;
}

export class ExerciseNotes {
  private pending: ReturnType<typeof setTimeout> | null = null;

  constructor(private readonly deps: NoteSyncDeps) {}

  /** The notes in Lifting/; one whose frontmatter won't parse is skipped. */
  async notes(): Promise<ExerciseNote[]> {
    const notes: ExerciseNote[] = [];
    const glob = new Bun.Glob(`${LIFTING_FOLDER}/*.md`);
    for await (const path of glob.scan({ cwd: this.deps.vault.root })) {
      const frontmatter = safeFrontmatter((await this.deps.vault.read(path)) ?? "");
      if (frontmatter) {
        notes.push(readExerciseNote(path, frontmatter));
      }
    }
    return notes;
  }

  /** Each exercise's history, named by its note when it has one. */
  async histories(): Promise<{ history: ExerciseHistory; note: ExerciseNote | undefined }[]> {
    const notes = await this.notes();
    const histories = await this.deps.lifting.histories(titlesOf(notes));
    return histories.map((history) => ({
      history,
      note: notes.find((n) => exerciseKey(n.title) === history.key),
    }));
  }

  /** Rewrites each exercise's history block; resolves to the notes that changed. */
  async sync(): Promise<string[]> {
    const changed: string[] = [];
    const rows = new Map<string, Promise<DerivedRow[]>>();
    const setsOn = (date: string) =>
      rows.get(date) ?? rows.set(date, this.deps.setsOn(date)).get(date);
    for (const { history, note } of await this.histories()) {
      const heartRate = new Map<string, SessionHeartRate | null>();
      for (const s of history.sessions) {
        heartRate.set(s.date, sessionHeartRate((await setsOn(s.date)) ?? [], history.key));
      }
      const next = nextTime(history, rangeOf(note, history.unit), this.deps.today());
      const block = historyBlock(history, next, (date) => heartRate.get(date) ?? null);
      const path = note?.path ?? `${LIFTING_FOLDER}/${fileTitle(history.title)}.md`;
      if (await this.writeBlock(path, block)) {
        changed.push(path);
      }
    }
    return changed;
  }

  /** Writes `reps` and `step` to the exercise's note, making the note when it has none. */
  async setRange(history: ExerciseHistory, note: ExerciseNote | undefined, range: RepRange) {
    const path = note?.path ?? `${LIFTING_FOLDER}/${fileTitle(history.title)}.md`;
    let unreadable = false;
    await this.deps.vault.update(path, (text) => {
      unreadable = text !== null && safeFrontmatter(text) === null;
      if (unreadable) {
        return null;
      }
      return editNote(text, { frontmatter: {}, body: "" }, (n) =>
        mergeFrontmatter(n, { reps: `${range.low}-${range.high}`, step: range.step }),
      );
    });
    if (unreadable) {
      throw new UnreadableNote(`${path} has frontmatter that won't parse; fix it in Obsidian.`);
    }
  }

  /** Syncs now, then every five minutes and shortly after the server writes a daily note. */
  start(): void {
    const run = () => this.sync().catch((err) => console.error("lifting notes:", err));
    void run();
    setInterval(run, EVERY_MS);
    this.deps.vault.onWrite((path) => {
      if (path.startsWith("Daily/")) {
        this.later(run);
      }
    });
  }

  private later(run: () => void): void {
    if (this.pending) {
      clearTimeout(this.pending);
    }
    this.pending = setTimeout(run, SETTLE_MS);
  }

  /** A note whose frontmatter won't parse is left for you to fix. */
  private writeBlock(path: string, block: string): Promise<boolean> {
    return this.deps.vault.update(path, (text) => {
      if (text !== null && safeFrontmatter(text) === null) {
        return null;
      }
      return editNote(text, { frontmatter: {}, body: "" }, (note) => ({
        ...note,
        body: replaceBlock(note.body, HISTORY_BLOCK, block),
      }));
    });
  }
}

function safeFrontmatter(text: string) {
  try {
    return parseNote(text).frontmatter;
  } catch {
    return null;
  }
}
