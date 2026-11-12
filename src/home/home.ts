// Gathers everything the home screen shows into one HomeView.

import { BATTERY_LOOKBACK_MS, latestBattery, type StrapBattery } from "../health/battery";
import type { DerivedStore } from "../health/derived-store";
import type { RawStore } from "../health/raw-store";
import type { HealthSync } from "../health/sync";
import type { TaskStore } from "../vault/task-store";
import { buildDays, groupTasks, nextEvent, WEEK_DAYS } from "./agenda";
import type { CalendarSource, CalendarStatus } from "./calendar";
import { HealthHistory } from "./health-history";
import { daySentence } from "./sentence";
import type { CalendarSyncView, HomeView } from "./types";

export interface HomeDeps {
  tasks: TaskStore;
  health: HealthHistory;
  calendar: CalendarSource;
  /** When strap data last arrived. */
  sync: () => Promise<HealthSync | null>;
  /** The strap's latest battery report. */
  battery: (now: number) => Promise<StrapBattery | null>;
  timeZone: string;
}

/** The home screen's sources, read from the server's stores. */
export function storeHomeDeps(stores: {
  tasks: TaskStore;
  raw: RawStore;
  derived: DerivedStore;
  calendar: CalendarSource;
  timeZone: string;
}): HomeDeps {
  const { tasks, raw, derived, calendar, timeZone } = stores;
  return {
    tasks,
    health: new HealthHistory(derived),
    calendar,
    sync: () => raw.readSync(),
    battery: async (now) =>
      latestBattery(await raw.readRange("battery", now - BATTERY_LOOKBACK_MS, now + 1)),
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

  const [allTasks, events, health, sync, battery] = await Promise.all([
    deps.tasks.list(),
    deps.calendar.events(from, to),
    deps.health.trends(healthDay),
    deps.sync(),
    deps.battery(now.getTime()),
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
    healthSync: sync
      ? {
          latestSample: new Date(sync.latestSampleTs).toISOString(),
          upload: new Date(sync.uploadTs).toISOString(),
          battery: battery
            ? {
                percent: battery.percent,
                charging: battery.charging ?? false,
                at: new Date(battery.ts).toISOString(),
              }
            : null,
        }
      : null,
    calendarSync: calendarSyncView(deps.calendar.status?.()),
    captureHints: deps.calendar.hints?.(now.getTime()) ?? null,
  };
}
