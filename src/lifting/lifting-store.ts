// The lifting logs in the vault's daily notes. A note is parsed again only when it changes, so
// reading every exercise's history stays cheap as the notes pile up.

import { basename } from "node:path";
import { type Exercise, parseLiftingLog } from "../vault/lifting";
import { isIsoDate } from "../vault/time";
import type { Vault } from "../vault/vault";
import { type DayLog, type ExerciseHistory, exerciseHistories } from "./history";

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
