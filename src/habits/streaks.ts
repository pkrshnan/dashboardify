// Streaks, the recent count and this week's progress for one habit (docs/habits.md). Pure: the
// caller says how each day went, so auto ticks (facts.ts) and hand ticks look the same here.

import type { Habit, Schedule, Weekday } from "./habit-note";

/** How a day went: ticked, not ticked, or not known yet (a fact still to come in). */
export type DayMark = "done" | "open" | "pending";

export interface HabitDays {
  /** The habit's first day; earlier days are neither done nor missed. */
  start: string;
  today: string;
  mark: (date: string) => DayMark;
}

export interface HabitStats {
  streak: number;
  /** A weekly habit's streak counts weeks that met it; the others count scheduled days done. */
  unit: "day" | "week";
  /** The last scheduled day was missed and today isn't done, so today decides the streak. */
  atRisk: boolean;
  /** Days done of the days scheduled in the last 30, or weeks met of the last 4. */
  recent: { done: number; of: number };
  /** Days done this Monday–Sunday week. */
  thisWeek: number;
  dueToday: boolean;
  doneToday: boolean;
}

/** How far back a streak is followed; the store reads this many days of notes. */
export const HISTORY_DAYS = 400;
const RECENT_DAYS = 30;
const RECENT_WEEKS = 4;
const MISSES_THAT_END_A_STREAK = 2;

type PlainDate = Temporal.PlainDate;
const plain = (date: string): PlainDate => Temporal.PlainDate.from(date);
const before = (a: PlainDate, b: PlainDate): boolean => Temporal.PlainDate.compare(a, b) < 0;

export function isScheduled(schedule: Schedule, date: string): boolean {
  return schedule.kind !== "days" || schedule.days.includes(plain(date).dayOfWeek as Weekday);
}

export function habitStats(habit: Habit, days: HabitDays): HabitStats {
  const thisWeek = weekCount(days, mondayOf(plain(days.today)));
  const doneToday = days.mark(days.today) === "done";
  if (habit.schedule.kind === "weekly") {
    const times = habit.schedule.times;
    const streak = weekStreak(days, times);
    return {
      streak,
      unit: "week",
      atRisk: isWeekAtRisk(days, times, thisWeek, streak),
      recent: recentWeeks(days, times),
      thisWeek,
      dueToday: thisWeek < times,
      doneToday,
    };
  }
  const streak = dayStreak(habit, days);
  return {
    streak,
    unit: "day",
    atRisk: streak > 0 && isDayAtRisk(habit, days),
    recent: recentDays(habit, days),
    thisWeek,
    dueToday: isScheduled(habit.schedule, days.today),
    doneToday,
  };
}

interface ScheduledDay {
  date: string;
  mark: DayMark;
  isToday: boolean;
}

/** The habit's scheduled days from today back to its start, newest first. */
function* scheduledDays(habit: Habit, days: HabitDays): Generator<ScheduledDay> {
  const start = plain(days.start);
  let day = plain(days.today);
  for (let i = 0; i < HISTORY_DAYS && !before(day, start); i++) {
    const date = day.toString();
    if (isScheduled(habit.schedule, date)) {
      yield { date, mark: days.mark(date), isToday: i === 0 };
    }
    day = day.subtract({ days: 1 });
  }
}

/**
 * Scheduled days done, back to the second miss in a row: one missed day is forgiven. Today not
 * done yet and days still pending neither count nor break it.
 */
function dayStreak(habit: Habit, days: HabitDays): number {
  let streak = 0;
  let misses = 0;
  for (const day of scheduledDays(habit, days)) {
    if (day.mark === "done") {
      streak++;
      misses = 0;
    } else if (day.mark === "open" && !day.isToday) {
      misses++;
      if (misses >= MISSES_THAT_END_A_STREAK) {
        break;
      }
    }
  }
  return streak;
}

function isDayAtRisk(habit: Habit, days: HabitDays): boolean {
  let today: DayMark | null = null;
  for (const day of scheduledDays(habit, days)) {
    if (day.isToday) {
      today = day.mark;
    } else if (day.mark !== "pending") {
      return today !== null && today !== "done" && day.mark === "open";
    }
  }
  return false;
}

function recentDays(habit: Habit, days: HabitDays): { done: number; of: number } {
  const window = plain(days.today).subtract({ days: RECENT_DAYS - 1 });
  const start = before(plain(days.start), window) ? window.toString() : days.start;
  let done = 0;
  let of = 0;
  for (const day of scheduledDays(habit, { ...days, start })) {
    const counts = day.mark === "done" || (day.mark === "open" && !day.isToday);
    if (counts) {
      of++;
      done += day.mark === "done" ? 1 : 0;
    }
  }
  return { done, of };
}

function mondayOf(day: PlainDate): PlainDate {
  return day.subtract({ days: day.dayOfWeek - 1 });
}

/** Days done in the week starting `monday`, counting only days from the start up to today. */
function weekCount(days: HabitDays, monday: PlainDate): number {
  const start = plain(days.start);
  const today = plain(days.today);
  let count = 0;
  for (let i = 0; i < 7; i++) {
    const day = monday.add({ days: i });
    const inRange = !(before(day, start) || before(today, day));
    count += inRange && days.mark(day.toString()) === "done" ? 1 : 0;
  }
  return count;
}

/** Monday of each week from this one back to the one the habit started in, newest first. */
function* weeks(days: HabitDays): Generator<{ monday: PlainDate; isCurrent: boolean }> {
  const start = plain(days.start);
  let monday = mondayOf(plain(days.today));
  for (let i = 0; i * 7 < HISTORY_DAYS && !before(monday.add({ days: 6 }), start); i++) {
    yield { monday, isCurrent: i === 0 };
    monday = monday.subtract({ days: 7 });
  }
}

/** Weeks in a row that met the target. This week counts once met and never breaks it. */
function weekStreak(days: HabitDays, times: number): number {
  let streak = 0;
  for (const { monday, isCurrent } of weeks(days)) {
    if (weekCount(days, monday) >= times) {
      streak++;
    } else if (!isCurrent) {
      break;
    }
  }
  return streak;
}

/** Every day left this week, today included, is needed to meet it. */
function isWeekAtRisk(days: HabitDays, times: number, thisWeek: number, streak: number): boolean {
  const daysLeft = 8 - plain(days.today).dayOfWeek;
  const needed = times - thisWeek;
  return streak > 0 && needed > 0 && needed === daysLeft;
}

/** The last four full weeks, plus this one once it's met. */
function recentWeeks(days: HabitDays, times: number): { done: number; of: number } {
  const [current, ...past] = weeks(days);
  const met = past.slice(0, RECENT_WEEKS).map(({ monday }) => weekCount(days, monday) >= times);
  if (current && weekCount(days, current.monday) >= times) {
    met.push(true);
  }
  return { done: met.filter(Boolean).length, of: met.length };
}
