// Gathers everything the home screen shows into one HomeView.

import type { StrapBattery } from "../health/battery";
import type { HealthSync } from "../health/sync";
import type { TaskStore } from "../vault/task-store";
import { buildDays, groupTasks, nextEvent, WEEK_DAYS } from "./agenda";
import type { CalendarSource, CalendarStatus } from "./calendar";
import type { HealthHistory } from "./health-history";
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

function calendarSyncView(status: CalendarStatus | undefined): CalendarSyncView | null {
  return status ? { lastSync: status.lastSyncTime ?? null, hasErrors: status.hasErrors } : null;
}

export async function homeView(deps: HomeDeps, now: Date): Promise<HomeView> {
  const zoned = Temporal.Instant.fromEpochMilliseconds(now.getTime()).toZonedDateTimeISO(
    deps.timeZone,
  );
  const today = zoned.toPlainDate();
  const from = today.toZonedDateTime(deps.timeZone).epochMilliseconds;
  const to = today.add({ days: WEEK_DAYS }).toZonedDateTime(deps.timeZone).epochMilliseconds;

  const [allTasks, events, health, sync, battery] = await Promise.all([
    deps.tasks.list(),
    deps.calendar.events(from, to),
    deps.health.trends(today.toString()),
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
