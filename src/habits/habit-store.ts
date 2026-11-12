// Habits.md and the ticks in daily notes: reading the habits, adding and editing one with the
// note's etag so a change made in Obsidian meanwhile isn't overwritten, and ticking a day.
// docs/habits.md has the format.

import { createHash } from "node:crypto";
import { isIsoDate } from "../vault/time";
import { habitIds, type Vault } from "../vault/vault";
import { parseRule } from "./facts";
import { datesBetween } from "./habit-day";
import {
  addHabit,
  type Habit,
  type HabitFields,
  isValidName,
  isValidSchedule,
  nextColor,
  parseHabits,
  updateHabit,
} from "./habit-note";
import { type DayMark, type HabitStats, HISTORY_DAYS, habitStats } from "./streaks";

export const HABITS_PATH = "Habits.md";

export interface HabitsDoc {
  habits: Habit[];
  /** A hash of Habits.md; an edit that sends an old one is refused. */
  etag: string;
}

export interface HabitWithStats {
  habit: Habit;
  stats: HabitStats;
  /** Its first day: `since`, else its first tick, else today. */
  start: string;
}

export type NewHabit = Pick<HabitFields, "name" | "schedule"> & Partial<HabitFields>;

export class HabitNotFound extends Error {}
export class StaleHabits extends Error {}
export class InvalidHabit extends Error {}

export class HabitStore {
  /** Each daily note's ticks with the mtime they were read at, so a stats call reads only changes. */
  private cache = new Map<string, { mtime: number | null; ids: string[] }>();

  constructor(private readonly vault: Vault) {}

  async read(): Promise<HabitsDoc> {
    const text = (await this.vault.read(HABITS_PATH)) ?? "";
    return { habits: parseHabits(text), etag: etagOf(text) };
  }

  async get(id: string): Promise<Habit | null> {
    return (await this.read()).habits.find((h) => h.id === id) ?? null;
  }

  /** Appends a habit to Habits.md (made when missing) with a fresh id and, unless given, colour. */
  async create(fields: NewHabit): Promise<Habit> {
    let added: Habit | undefined;
    await this.vault.update(HABITS_PATH, (current) => {
      const text = current ?? "# Habits\n";
      const color = fields.color ?? nextColor(parseHabits(text));
      const full = {
        auto: null,
        since: null,
        state: "active" as const,
        extra: [],
        ...fields,
        color,
      };
      const result = addHabit(text, checked(full));
      added = result.habit;
      return result.text;
    });
    if (!added) {
      throw new Error("Habits.md didn't change");
    }
    return added;
  }

  /** Rewrites one habit's line. `etag`, when given, must match Habits.md as it is now. */
  async update(id: string, etag: string | undefined, patch: Partial<HabitFields>): Promise<Habit> {
    let stale = false;
    let updated: Habit | null = null;
    await this.vault.update(HABITS_PATH, (current) => {
      const text = current ?? "";
      if (etag && etag !== etagOf(text)) {
        stale = true;
        return null;
      }
      const habit = parseHabits(text).find((h) => h.id === id);
      const result = habit ? updateHabit(text, id, checked({ ...habit, ...patch })) : null;
      updated = result?.habit ?? null;
      return result?.text ?? null;
    });
    if (stale) {
      throw new StaleHabits("Habits.md changed since you loaded it. Reload and try again.");
    }
    if (!updated) {
      throw new HabitNotFound(`No habit ${id}.`);
    }
    return updated;
  }

  /** Ticks or unticks a habit on a day. Ticking twice is one tick. */
  async mark(id: string, date: string, done: boolean): Promise<void> {
    if (!isIsoDate(date)) {
      throw new InvalidHabit(`${date} isn't a date.`);
    }
    if (!(await this.get(id))) {
      throw new HabitNotFound(`No habit ${id}.`);
    }
    await this.vault.editHabitMarks(date, (ids) =>
      done ? [...ids, id] : ids.filter((other) => other !== id),
    );
  }

  /** The habit ids ticked on each day from `from` to `to`; days with none are left out. */
  async marks(from: string, to: string): Promise<Map<string, Set<string>>> {
    const marks = new Map<string, Set<string>>();
    for (const date of datesBetween(from, to)) {
      const ids = await this.ticksOn(date);
      if (ids.length > 0) {
        marks.set(date, new Set(ids));
      }
    }
    return marks;
  }

  /**
   * Every habit with its streak and counts as of `today`. A hand tick always counts; on a day
   * without one, `mark` can say how it went (auto ticks), or null for not done.
   */
  async stats(
    today: string,
    mark: (habit: Habit, date: string) => DayMark | null = () => null,
  ): Promise<HabitWithStats[]> {
    const from = Temporal.PlainDate.from(today).subtract({ days: HISTORY_DAYS }).toString();
    const marks = await this.marks(from, today);
    return (await this.read()).habits.map((habit) => {
      const start = startOf(habit, marks, today);
      const days = {
        start,
        today,
        mark: (date: string): DayMark =>
          marks.get(date)?.has(habit.id) ? "done" : (mark(habit, date) ?? "open"),
      };
      return { habit, stats: habitStats(habit, days), start };
    });
  }

  private async ticksOn(date: string): Promise<string[]> {
    const path = this.vault.dailyPath(date);
    const mtime = await this.vault.mtime(path);
    const cached = this.cache.get(date);
    if (cached && cached.mtime === mtime) {
      return cached.ids;
    }
    const note = mtime === null ? null : await this.vault.readDaily(date);
    const ids = note ? habitIds(note.frontmatter) : [];
    this.cache.set(date, { mtime, ids });
    return ids;
  }
}

/** The earlier of `since` and the first tick, so fixing a day before `since` counts; else today. */
function startOf(habit: Habit, marks: Map<string, Set<string>>, today: string): string {
  const first = [...marks.keys()].sort().find((date) => marks.get(date)?.has(habit.id));
  const earliest = [habit.since, first, today].filter(
    (d): d is string => d !== null && d !== undefined,
  );
  return earliest.sort()[0] ?? today;
}

function checked<T extends HabitFields>(fields: T): T {
  if (!isValidName(fields.name)) {
    throw new InvalidHabit("A habit's name can't be empty or hold · or comment markers.");
  }
  if (fields.auto && !parseRule(fields.auto)) {
    throw new InvalidHabit(`"${fields.auto}" isn't a rule: a fact, then ≥ or ≤ and a value.`);
  }
  if (!isValidSchedule(fields.schedule)) {
    throw new InvalidHabit("A habit runs every day, 1–7 times a week, or on at least one weekday.");
  }
  return { ...fields, name: fields.name.trim() };
}

function etagOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}
