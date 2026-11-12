// Gathers everything the home screen shows into one HomeView.

import { FactReader } from "../habits/facts";
import { HabitProgress } from "../habits/habit-progress";
import { HabitStore } from "../habits/habit-store";
import { BATTERY_LOOKBACK_MS, latestBattery, type StrapBattery } from "../health/battery";
import type { DerivedStore } from "../health/derived-store";
import type { RawStore } from "../health/raw-store";
import type { HealthSync } from "../health/sync";
import type { TaskStore } from "../vault/task-store";
import type { Vault } from "../vault/vault";
import { buildDays, groupTasks, nextEvent, WEEK_DAYS } from "./agenda";
import type { CalendarSource, CalendarStatus } from "./calendar";
import { HealthHistory } from "./health-history";
import { daySentence } from "./sentence";
import type { CalendarSyncView, HomeHabit, HomeView } from "./types";

export interface HomeDeps {
  tasks: TaskStore;
  health: HealthHistory;
  calendar: CalendarSource;
  /** When strap data last arrived. */
  sync: () => Promise<HealthSync | null>;
  /** The strap's latest battery report. */
  battery: (now: number) => Promise<StrapBattery | null>;
  /** Habits with their progress; shared with the HabitService. */
  habits: HabitProgress;
  timeZone: string;
}

/** The home screen's sources, read from the server's stores. */
export function storeHomeDeps(stores: {
  vault: Vault;
  tasks: TaskStore;
  raw: RawStore;
  derived: DerivedStore;
  calendar: CalendarSource;
  timeZone: string;
}): HomeDeps {
  const { vault, tasks, raw, derived, calendar, timeZone } = stores;
  return {
    tasks,
    health: new HealthHistory(derived),
    calendar,
    sync: () => raw.readSync(),
    battery: async (now) =>
      latestBattery(await raw.readRange("battery", now - BATTERY_LOOKBACK_MS, now + 1)),
    habits: new HabitProgress(new HabitStore(vault), new FactReader(vault, derived), timeZone),
    timeZone,
  };
}

function calendarSyncView(status: CalendarStatus | undefined): CalendarSyncView | null {
  return status ? { lastSync: status.lastSyncTime ?? null, hasErrors: status.hasErrors } : null;
}

/**
 * The home view as of `now`. `asOf`, a YYYY-MM-DD day, ends the health metrics there instead, for
 * the Health page's past nights; one after today is today, since there is no data yet.
 */
export async function homeView(deps: HomeDeps, now: Date, asOf?: string): Promise<HomeView> {
  const zoned = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(
    deps.timeZone,
  );
  const today = zoned.toPlainDate();
  const from = today.toZonedDateTime(deps.timeZone).epochMilliseconds;
  const to = today.add({ days: WEEK_DAYS }).toZonedDateTime(deps.timeZone).epochMilliseconds;
  const healthDay = asOf && asOf < today.toString() ? asOf : today.toString();

  const [allTasks, events, health, sync, battery, habits] = await Promise.all([
    deps.tasks.list(),
    deps.calendar.events(from, to),
    deps.health.trends(healthDay),
    deps.sync(),
    deps.battery(now.getTime()),
    todaysHabits(deps.habits, now),
  ]);
  const days = buildDays(today.toString(), deps.timeZone, events, allTasks);
  const next = nextEvent(days[0], zoned.hour * 60 + zoned.minute);
  const tasks = groupTasks(allTasks, today.toString());

  return {
    timeZone: deps.timeZone,
    date: today.toString(),
    generatedAt: now.toISOString(),
    sentence: daySentence({ next, health, tasks }),
    next,
    days,
    tasks,
    health,
    healthSync: healthSyncView(sync, battery),
    calendarSync: calendarSyncView(deps.calendar.status?.()),
    captureHints: deps.calendar.hints?.(now.getTime()) ?? null,
    habits,
  };
}

function healthSyncView(sync: HealthSync | null, battery: StrapBattery | null) {
  if (!sync) {
    return null;
  }
  return {
    latestSample: new Date(sync.latestSampleTs).toISOString(),
    upload: new Date(sync.uploadTs).toISOString(),
    battery: battery
      ? {
          percent: battery.percent,
          charging: battery.charging ?? false,
          at: new Date(battery.ts).toISOString(),
        }
      : null,
  };
}

/** The habits due today or already done, in Habits.md's order; paused and archived ones aren't. */
async function todaysHabits(progress: HabitProgress, now: Date): Promise<HomeHabit[]> {
  const today = progress.today(now);
  const { habits } = await progress.all(today, today);
  return habits
    .filter(({ habit, stats }) => habit.state === "active" && (stats.dueToday || stats.doneToday))
    .map(({ habit, stats }) => ({
      id: habit.id,
      name: habit.name,
      color: habit.color ?? "",
      day: today,
      done: stats.doneToday,
      auto: habit.auto !== null,
    }));
}
