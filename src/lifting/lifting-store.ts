// The lifting logs in the vault's daily notes: reading every exercise's history, and writing one
// exercise of a day's log from the log screen. A note is parsed again only when it changes, so
// reading the history stays cheap as the notes pile up.

import { createHash } from "node:crypto";
import { basename } from "node:path";
import { type Exercise, LIFTING_SECTION, parseLiftingLog, type WeightUnit } from "../vault/lifting";
import { sectionLines } from "../vault/markdown";
import { isIsoDate } from "../vault/time";
import type { Vault } from "../vault/vault";
import { type DayLog, type ExerciseHistory, exerciseHistories, type WorkSet } from "./history";
import { removeExercise, replaceExercise } from "./log-edit";

export interface DayLift extends DayLog {
  /**
   * A hash of the day's `## Workouts`, not the whole note, so the health summary rewriting its
   * block doesn't make a log screen's next save stale.
   */
  etag: string;
}

/** The day's log changed since the etag was read. */
export class StaleLog extends Error {}

export class LiftingStore {
  private readonly parsed = new Map<string, { mtime: number; exercises: Exercise[] }>();

  constructor(private readonly vault: Vault) {}

  /** Every day with a lifting log, oldest first. */
  async days(): Promise<DayLog[]> {
    const days: DayLog[] = [];
    for (const path of await this.dailyPaths()) {
      const exercises = await this.exercisesIn(path);
      if (exercises.length > 0) {
        days.push({ date: basename(path, ".md"), exercises });
      }
    }
    return days.sort((a, b) => a.date.localeCompare(b.date));
  }

  /** Every exercise's history, the one done most recently first. */
  async histories(): Promise<ExerciseHistory[]> {
    return exerciseHistories(await this.days());
  }

  /** One day's log, with the etag a write must send back. */
  async day(date: string): Promise<DayLift> {
    const note = await this.vault.readDaily(date);
    return dayLift(date, note?.body ?? "");
  }

  /** Replaces `title`'s sets in the day's log, adding the exercise when it isn't there. */
  putExercise(
    date: string,
    title: string,
    unit: WeightUnit,
    sets: WorkSet[],
    etag?: string,
  ): Promise<DayLift> {
    return this.editDay(date, etag, (body) => replaceExercise(body, title, unit, sets));
  }

  /** Takes `title` and its lines out of the day's log. */
  removeExercise(date: string, title: string, etag?: string): Promise<DayLift> {
    return this.editDay(date, etag, (body) => removeExercise(body, title));
  }

  private async editDay(
    date: string,
    etag: string | undefined,
    edit: (body: string) => string,
  ): Promise<DayLift> {
    let stale = false;
    await this.vault.editDailyBody(date, (body) => {
      stale = etag !== undefined && etag !== etagOf(body);
      return stale ? null : edit(body);
    });
    if (stale) {
      throw new StaleLog(`The ${date} log changed; reload it.`);
    }
    return this.day(date);
  }

  private async exercisesIn(path: string): Promise<Exercise[]> {
    const mtime = (await this.vault.mtime(path)) ?? 0;
    const cached = this.parsed.get(path);
    if (cached?.mtime === mtime) {
      return cached.exercises;
    }
    const exercises = parseLiftingLog((await this.vault.read(path)) ?? "");
    this.parsed.set(path, { mtime, exercises });
    return exercises;
  }

  private async dailyPaths(): Promise<string[]> {
    const paths: string[] = [];
    for await (const path of new Bun.Glob("Daily/*/*.md").scan({ cwd: this.vault.root })) {
      if (isIsoDate(basename(path, ".md"))) {
        paths.push(path);
      }
    }
    return paths;
  }
}

function dayLift(date: string, body: string): DayLift {
  return { date, exercises: parseLiftingLog(body), etag: etagOf(body) };
}

function etagOf(body: string): string {
  const section = (sectionLines(body, LIFTING_SECTION) ?? []).join("\n").trimEnd();
  return createHash("sha1").update(section).digest("hex").slice(0, 16);
}
