// Every habit's streak and counts as of a day, with auto ticks read from the day's facts. One
// instance serves the HabitService and the home screen, so they share FactReader's cache.

import { autoMarker, type DayFacts, type FactReader } from "./facts";
import { habitDay } from "./habit-day";
import type { Habit } from "./habit-note";
import type { HabitStore, HabitWithStats } from "./habit-store";
import { HISTORY_DAYS } from "./streaks";

export class HabitProgress {
  constructor(
    readonly store: HabitStore,
    readonly facts: FactReader,
    readonly timeZone: string,
  ) {}

  /** The habit day `now` falls in: until 04:00 it's still the day before. */
  today(now: Date): string {
    return habitDay(now, this.timeZone);
  }

  /** Every habit as of `day`; `today` decides which days are still pending. */
  async all(day: string, today: string): Promise<{ habits: HabitWithStats[]; etag: string }> {
    const { habits, etag } = await this.store.read();
    const from = Temporal.PlainDate.from(day).subtract({ days: HISTORY_DAYS }).toString();
    const facts = await this.factsFor(habits, from, day);
    return { habits: await this.store.stats(day, autoMarker(facts, today)), etag };
  }

  /** The facts from `from` to `to`, read only when one of `habits` has a rule. */
  async factsFor(habits: Habit[], from: string, to: string): Promise<Map<string, DayFacts>> {
    return habits.some((h) => h.auto) ? this.facts.range(from, to) : new Map();
  }
}
