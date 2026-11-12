// HabitService: habits in Habits.md, ticks in daily notes, and auto ticks from the day's facts
// (docs/habits.md). Days are habit days, which run until 04:00 in the vault's time zone.

import { autoMarker, FACTS, type FactDef } from "../../habits/facts";
import type { HabitFields, HabitState, Schedule, Weekday } from "../../habits/habit-note";
import type { HabitProgress } from "../../habits/habit-progress";
import {
  HabitNotFound,
  type HabitWithStats,
  InvalidHabit,
  StaleHabits,
} from "../../habits/habit-store";
import { type DayMark, HISTORY_DAYS, isScheduled } from "../../habits/streaks";
import { fromDateParts, toDateParts } from "./date-time";
import { ApiError, invalidArgument } from "./errors";
import type { DateParts } from "./requests";
import { requestedFields } from "./update-mask";

interface ScheduleInput {
  kind?: string;
  timesPerWeek?: number;
  days?: string[];
}

interface HabitInput {
  name?: string;
  displayName?: string;
  schedule?: ScheduleInput;
  auto?: string;
  color?: string;
  state?: string;
}

export interface HabitDeps {
  progress: HabitProgress;
  now: () => Date;
}

const HABIT_FIELDS = ["displayName", "schedule", "auto", "color", "state"];
const DAY_NAMES = ["MONDAY", "TUESDAY", "WEDNESDAY", "THURSDAY", "FRIDAY", "SATURDAY", "SUNDAY"];
/** The page's grid: 36 weeks. */
const DEFAULT_DAYS = 252;

export class HabitsService {
  constructor(private readonly deps: HabitDeps) {}

  listHabits = async (request: { day?: DateParts; showArchived?: boolean }) => {
    const day = this.dayOf(request.day);
    const { habits, etag } = await this.deps.progress.all(day, this.today());
    const shown = habits.filter((h) => request.showArchived || h.habit.state !== "archived");
    return { habits: shown.map((h) => habitView(h, etag, day)) };
  };

  getHabit = async (request: { name: string; day?: DateParts }) => {
    const day = this.dayOf(request.day);
    return this.view(idFrom(request.name), day);
  };

  createHabit = async (request: { habit: HabitInput }) => {
    const input = request.habit;
    const name = (input.displayName ?? "").trim();
    const existing = (await this.deps.progress.store.read()).habits.find(
      (h) => h.name.toLowerCase() === name.toLowerCase(),
    );
    const habit =
      existing ??
      (await this.guard(() =>
        this.deps.progress.store.create({
          name,
          schedule: scheduleFrom(input.schedule),
          auto: input.auto?.trim() || null,
          color: input.color?.toUpperCase() || undefined,
          since: this.today(),
        }),
      ));
    return this.view(habit.id, this.today());
  };

  updateHabit = async (request: { habit: HabitInput; updateMask?: string; etag?: string }) => {
    const id = idFrom(request.habit.name ?? "");
    const fields = requestedFields(request, request.habit, HABIT_FIELDS);
    const patch = habitPatch(request.habit, fields);
    await this.guard(() => this.deps.progress.store.update(id, request.etag, patch));
    return this.view(id, this.today());
  };

  listHabitDays = async (request: {
    parent: string;
    startDate?: DateParts;
    endDate?: DateParts;
  }) => {
    const id = idFrom(request.parent);
    const today = this.today();
    const to = request.endDate ? fromDateParts(request.endDate) : today;
    const from = request.startDate
      ? fromDateParts(request.startDate)
      : shift(to, -(DEFAULT_DAYS - 1));
    if (from > to || shift(from, HISTORY_DAYS) < to) {
      invalidArgument(
        `start_date must be on or before end_date, and at most ${HISTORY_DAYS} days before`,
      );
    }
    const { habits } = await this.deps.progress.all(today, today);
    const found = habits.find((h) => h.habit.id === id);
    if (!found) {
      throw notFound(`habits/${id}`);
    }
    return { days: await this.daysOf(found, from, to, today) };
  };

  markHabit = async (request: { name: string; day?: DateParts; done?: boolean }) => {
    const id = idFrom(request.name);
    const today = this.today();
    const day = this.dayOf(request.day);
    if (day > today) {
      invalidArgument("A day that hasn't happened yet can't be ticked.");
    }
    await this.guard(() => this.deps.progress.store.mark(id, day, request.done === true));
    return this.view(id, today);
  };

  listHabitFacts = () => ({
    facts: Object.entries(FACTS).map(([name, def]) => factView(name, def)),
  });

  private today(): string {
    return this.deps.progress.today(this.deps.now());
  }

  private dayOf(date: DateParts | undefined): string {
    return date ? fromDateParts(date) : this.today();
  }

  private async view(id: string, day: string) {
    const { habits, etag } = await this.deps.progress.all(day, this.today());
    const found = habits.find((h) => h.habit.id === id);
    if (!found) {
      throw notFound(`habits/${id}`);
    }
    return habitView(found, etag, day);
  }

  private async daysOf(found: HabitWithStats, from: string, to: string, today: string) {
    const { habit, start } = found;
    const ticks = await this.deps.progress.store.marks(from, to);
    const auto = autoMarker(await this.deps.progress.factsFor([habit], from, to), today);
    const days = [];
    for (let date = from; date <= to; date = shift(date, 1)) {
      const ticked = ticks.get(date)?.has(habit.id) === true;
      const mark: DayMark | "before" = date < start ? "before" : dayMark(ticked, auto(habit, date));
      days.push({
        date: toDateParts(date),
        mark: MARKS[mark],
        scheduled: isScheduled(habit.schedule, date),
        ticked,
      });
    }
    return days;
  }

  /** Store errors as API errors. */
  private async guard<T>(fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (error) {
      if (error instanceof HabitNotFound) {
        throw new ApiError(404, error.message, "not_found");
      }
      if (error instanceof StaleHabits) {
        throw new ApiError(409, error.message, "aborted");
      }
      if (error instanceof InvalidHabit) {
        invalidArgument(error.message);
      }
      throw error;
    }
  }
}

const MARKS: Record<DayMark | "before", string> = {
  done: "MARK_DONE",
  open: "MARK_OPEN",
  pending: "MARK_PENDING",
  before: "MARK_BEFORE_START",
};

function dayMark(ticked: boolean, auto: DayMark | null): DayMark {
  return ticked ? "done" : (auto ?? "open");
}

function shift(date: string, days: number): string {
  return Temporal.PlainDate.from(date).add({ days }).toString();
}

function idFrom(name: string): string {
  const match = /^habits\/([a-z0-9-]+)$/.exec(name);
  if (!match?.[1]) {
    invalidArgument("name must be habits/{habit}");
  }
  return match[1];
}

function notFound(name: string): ApiError {
  return new ApiError(404, `${name} not found`, "not_found");
}

/**
 * The fields to change. Protobuf JSON leaves out empty strings and unset enums, so a masked
 * field that's missing means cleared: no rule, no colour, active.
 */
function habitPatch(input: HabitInput, fields: string[]): Partial<HabitFields> {
  return {
    ...(fields.includes("displayName") && { name: input.displayName ?? "" }),
    ...(fields.includes("schedule") && { schedule: scheduleFrom(input.schedule) }),
    ...(fields.includes("auto") && { auto: input.auto?.trim() || null }),
    ...(fields.includes("color") && { color: input.color?.toUpperCase() || null }),
    ...(fields.includes("state") && { state: stateFrom(input.state) }),
  };
}

function scheduleFrom(input: ScheduleInput | undefined): Schedule {
  if (input?.kind === "KIND_WEEKLY") {
    return { kind: "weekly", times: input.timesPerWeek ?? 0 };
  }
  if (input?.kind === "KIND_DAYS") {
    const days = (input.days ?? []).map((d) => DAY_NAMES.indexOf(d) + 1);
    return { kind: "days", days: days.filter((d): d is Weekday => d > 0) };
  }
  return { kind: "daily" };
}

function stateFrom(state: string | undefined): HabitState {
  if (state === "STATE_PAUSED") {
    return "paused";
  }
  return state === "STATE_ARCHIVED" ? "archived" : "active";
}

function scheduleView(schedule: Schedule) {
  if (schedule.kind === "weekly") {
    return { kind: "KIND_WEEKLY", timesPerWeek: schedule.times };
  }
  if (schedule.kind === "days") {
    return { kind: "KIND_DAYS", days: schedule.days.map((d) => DAY_NAMES[d - 1]) };
  }
  return { kind: "KIND_DAILY" };
}

function habitView({ habit, stats, start }: HabitWithStats, etag: string, day: string) {
  return {
    name: `habits/${habit.id}`,
    displayName: habit.name,
    schedule: scheduleView(habit.schedule),
    auto: habit.auto ?? "",
    color: habit.color ?? "",
    state: `STATE_${habit.state.toUpperCase()}`,
    startDate: toDateParts(start),
    progress: {
      day: toDateParts(day),
      streak: stats.streak,
      unit: stats.unit === "week" ? "UNIT_WEEK" : "UNIT_DAY",
      atRisk: stats.atRisk,
      recentDone: stats.recent.done,
      recentOf: stats.recent.of,
      thisWeek: stats.thisWeek,
      due: stats.dueToday,
      done: stats.doneToday,
    },
    etag,
  };
}

function factView(name: string, def: FactDef) {
  return {
    name,
    label: def.label,
    kind: def.kind,
    night: def.night,
    defaultRule: `${name} ${def.rule.op === ">=" ? "≥" : "≤"} ${ruleValue(def)}`,
  };
}

function ruleValue(def: FactDef): string {
  if (def.kind !== "time") {
    return String(def.rule.value);
  }
  const minutes = (def.rule.value + 720) % 1440;
  return `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
}
