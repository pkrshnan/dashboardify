import { type HomeDeps, homeView } from "../../home/home";
import type {
  AgendaEvent,
  DayAgenda,
  MetricTrend,
  NextEvent,
  Reminder,
  TaskGroup,
} from "../../home/types";
import { toDateParts, toTimeParts } from "./date-time";
import { invalidArgument } from "./errors";
import type { ApiRequests } from "./requests";

/** Converts the computed home view into the public API's resource names and date/time fields. */
export class HomeService {
  constructor(
    private readonly home: HomeDeps,
    private readonly now: () => Date,
  ) {}

  getHome = async (request: ApiRequests["getHome"]) => {
    if (request.name !== "home") {
      invalidArgument("name must be home");
    }
    const view = await homeView(this.home, this.now());
    return {
      name: "home",
      timeZone: view.timeZone,
      date: toDateParts(view.date),
      generateTime: view.generatedAt,
      sentence: view.sentence,
      nextEvent: view.next ? nextEventResource(view.next) : undefined,
      days: view.days.map(dayResource),
      taskGroups: view.tasks.map(taskGroupResource),
      metrics: view.health.map(metricResource),
      healthSync: view.healthSync
        ? {
            latestSampleTime: view.healthSync.latestSample,
            uploadTime: view.healthSync.upload,
          }
        : undefined,
      calendarSync: view.calendarSync
        ? {
            lastSyncTime: view.calendarSync.lastSync ?? undefined,
            hasErrors: view.calendarSync.hasErrors,
          }
        : undefined,
      captureHints: view.captureHints ?? undefined,
    };
  };
}

function nextEventResource(event: NextEvent) {
  return {
    title: event.title,
    startTime: toTimeParts(event.start),
    detail: event.detail,
    minutesUntil: event.inMin,
    url: event.url ?? "",
  };
}

function eventResource(event: AgendaEvent) {
  return {
    title: event.title,
    startTime: toTimeParts(event.start),
    endTime: toTimeParts(event.end),
    startMinute: event.startMin,
    endMinute: event.endMin,
    detail: event.detail,
    category: event.category,
    url: event.url ?? "",
    event: event.event ?? "",
    calendar: event.calendar ?? "",
    writable: event.writable,
    allDay: event.allDay,
  };
}

function reminderResource(reminder: Reminder) {
  return {
    task: `tasks/${reminder.id}`,
    text: reminder.text,
    time: toTimeParts(reminder.time),
    minute: reminder.minutes,
    done: reminder.done,
  };
}

function dayResource(day: DayAgenda) {
  return {
    date: toDateParts(day.date),
    events: day.events.map(eventResource),
    reminders: day.reminders.map(reminderResource),
    datedTasks: day.dated,
    allDayEvents: day.allDay.map(eventResource),
  };
}

function taskGroupResource(group: TaskGroup) {
  return {
    displayName: group.name,
    tasks: group.tasks.map((task) => ({
      task: `tasks/${task.id}`,
      text: task.text,
      meta: task.meta,
    })),
  };
}

function metricResource(metric: MetricTrend) {
  return {
    key: metric.key,
    displayName: metric.name,
    unit: metric.unit,
    group: metric.group,
    value: metric.value ?? undefined,
    rawValue: metric.raw ?? undefined,
    delta: metric.delta ?? undefined,
    tone: `TONE_${metric.tone.toUpperCase()}`,
    partialToday: metric.partial,
    yesterdayValue: metric.yesterdayValue ?? undefined,
    baseline: metric.baseline ?? undefined,
    dailyValues: metric.values.map((value) => value ?? 0),
    missingDays: metric.values.flatMap((value, index) => (value === null ? [index] : [])),
    lastDate: toDateParts(metric.lastDate),
  };
}
