// Talks to the server's /api. Opened through Tailscale, the server knows who you are and no
// token is needed. Anywhere else (local development, the demo) the server answers 401, and the
// sign-in screen asks for a device token, which is kept in localStorage.

import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import {
  ListActivityDaysResponseSchema,
  type Workout,
  WorkoutSchema,
  WorkoutStatus,
} from "../src/gen/dashboardify/v1/activity_pb";
import {
  type AgendaEvent as AgendaEventMessage,
  HomeSchema,
} from "../src/gen/dashboardify/v1/home_pb";
import type { AgendaEvent, HomeView } from "../src/home/types";
import type { ActivityDayView, WorkoutDetail, WorkoutView } from "./lib/activity";

const TOKEN_KEY = "dashboardify.token";

export class Unauthorized extends Error {
  /** The server is waiting for its first-run setup code. */
  constructor(readonly setup = false) {
    super("unauthorized");
  }
}

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Private mode: the token lasts until the page closes.
  }
}

export type Token = string | null;

async function call<T>(token: Token, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(path, { ...init, headers });
  if (response.status === 401) {
    const body = (await response.json().catch(() => ({}))) as { setup?: boolean };
    throw new Unauthorized(body.setup === true);
  }
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

// biome-ignore lint/complexity/noExcessiveLinesPerFunction: explicit conversion from protobuf dates, times and enums into the existing presentation model
export async function fetchHome(token: Token): Promise<HomeView> {
  const v = fromJson(HomeSchema, await call<JsonValue>(token, "/v1/home"));
  const date = (d: { year: number; month: number; day: number } | undefined) =>
    d ? `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}` : "";
  const time = (t: { hours: number; minutes: number } | undefined) =>
    t ? `${String(t.hours).padStart(2, "0")}:${String(t.minutes).padStart(2, "0")}` : "";
  return {
    timeZone: v.timeZone,
    date: date(v.date),
    generatedAt: isoTime(v.generateTime),
    sentence: v.sentence,
    next: v.nextEvent
      ? {
          title: v.nextEvent.title,
          start: time(v.nextEvent.startTime),
          detail: v.nextEvent.detail,
          inMin: v.nextEvent.minutesUntil,
          url: v.nextEvent.url || null,
        }
      : null,
    days: v.days.map((d) => ({
      date: date(d.date),
      events: d.events.map((e) => agendaEvent(e, time)),
      allDay: d.allDayEvents.map((e) => agendaEvent(e, time)),
      reminders: d.reminders.map((r) => ({
        id: r.task.slice(6),
        text: r.text,
        time: time(r.time),
        minutes: r.minute,
        done: r.done,
      })),
      dated: d.datedTasks,
    })),
    tasks: v.taskGroups.map((g) => ({
      name: g.displayName as HomeView["tasks"][number]["name"],
      tasks: g.tasks.map((t) => ({ id: t.task.slice(6), text: t.text, meta: t.meta })),
    })),
    health: v.metrics.map((m) => ({
      key: m.key,
      name: m.displayName,
      unit: m.unit,
      group: m.group as HomeView["health"][number]["group"],
      value: m.value ?? null,
      raw: m.rawValue ?? null,
      delta: m.delta ?? null,
      tone: ({ 1: "good", 2: "bad" } as const)[m.tone as 1 | 2] ?? "neutral",
      partial: m.partialToday,
      yesterdayValue: m.yesterdayValue ?? null,
      baseline: m.baseline ?? null,
      values: m.dailyValues.map((v, i) => (m.missingDays.includes(i) ? null : v)),
      lastDate: date(m.lastDate),
    })),
    healthSync: v.healthSync
      ? {
          latestSample: isoTime(v.healthSync.latestSampleTime),
          upload: isoTime(v.healthSync.uploadTime),
        }
      : null,
    calendarSync: v.calendarSync
      ? {
          lastSync: v.calendarSync.lastSyncTime ? isoTime(v.calendarSync.lastSyncTime) : null,
          hasErrors: v.calendarSync.hasErrors,
        }
      : null,
    captureHints: v.captureHints
      ? {
          calendars: v.captureHints.calendars.map((c) => ({
            name: c.name,
            displayName: c.displayName,
            category: c.category as AgendaEvent["category"],
          })),
          defaultCalendar: v.captureHints.defaultCalendar || undefined,
          rules: v.captureHints.rules.map((r) => ({ words: r.words, calendar: r.calendar })),
          titles: v.captureHints.titles.map((t) => ({
            titleKey: t.titleKey,
            calendar: t.calendar,
            count: t.count,
            lastTime: isoTime(t.lastTime),
          })),
        }
      : null,
  };
}

type Time = (t: { hours: number; minutes: number } | undefined) => string;

function agendaEvent(e: AgendaEventMessage, time: Time): AgendaEvent {
  return {
    title: e.title,
    start: time(e.startTime),
    end: time(e.endTime),
    startMin: e.startMinute,
    endMin: e.endMinute,
    detail: e.detail,
    category: e.category as AgendaEvent["category"],
    url: e.url || null,
    event: e.event || null,
    calendar: e.calendar || null,
    writable: e.writable,
    allDay: e.allDay,
  };
}

function isoTime(t: { seconds: bigint; nanos: number } | undefined): string {
  return new Date(
    Number(t?.seconds ?? 0n) * 1000 + Math.floor((t?.nanos ?? 0) / 1e6),
  ).toISOString();
}

export function completeTask(token: Token, id: string): Promise<unknown> {
  return call(token, `/v1/tasks/${encodeURIComponent(id)}:complete`, {
    method: "POST",
    body: "{}",
  });
}

export interface CaptureResult {
  /** "events/{id}" or "tasks/{id}", for Undo. */
  name: string;
  kind: "event" | "reminder";
  message: string;
}

/**
 * One line from the capture box. The server parses it again with its own clock; `kind` and
 * `calendar` are sent only when picked by hand. The same request id makes one event or task.
 */
export async function capture(
  token: Token,
  request: { text: string; requestId: string; kind?: "event" | "reminder"; calendar?: string },
): Promise<CaptureResult> {
  const kind =
    request.kind &&
    { event: "CAPTURE_KIND_EVENT", reminder: "CAPTURE_KIND_REMINDER" }[request.kind];
  const result = await call<{ event?: { name: string }; task?: { name: string }; message: string }>(
    token,
    "/dashboardify.v1.CaptureService/Capture",
    {
      method: "POST",
      body: JSON.stringify({ ...request, kind }),
    },
  );
  return result.event
    ? { name: result.event.name, kind: "event", message: result.message }
    : { name: result.task?.name ?? "", kind: "reminder", message: result.message };
}

/** Undo for an event the capture box just added. `name` is "events/{id}". */
export function deleteEvent(token: Token, name: string): Promise<unknown> {
  return call(token, "/dashboardify.v1.EventService/DeleteEvent", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Undo for a task the capture box just added. `name` is "tasks/{id}". */
export function deleteTask(token: Token, name: string): Promise<unknown> {
  return call(token, "/dashboardify.v1.TaskService/DeleteTask", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/**
 * First run: adds this device using the setup code the server printed, and returns the new
 * device's token to keep.
 */
export async function setUpDevice(code: string, displayName: string): Promise<string> {
  const device = await call<{ token: string }>(
    code,
    "/dashboardify.v1.DeviceService/CreateDevice",
    {
      method: "POST",
      body: JSON.stringify({ device: { displayName }, requestId: randomKey() }),
    },
  );
  return device.token;
}

/** randomUUID needs HTTPS; over plain HTTP on the tailnet fall back to random bytes. */
export function randomKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}

/** Each day's workouts and walks from `start` to `end` (YYYY-MM-DD, inclusive). */
export async function fetchActivity(
  token: Token,
  start: string,
  end: string,
): Promise<ActivityDayView[]> {
  const query = [dateQuery("startDate", start), dateQuery("endDate", end)].join("&");
  const v = fromJson(
    ListActivityDaysResponseSchema,
    await call<JsonValue>(token, `/v1/activityDays?${query}`),
  );
  return v.days.map((d) => ({
    date: `${d.date?.year}-${pad(d.date?.month)}-${pad(d.date?.day)}`,
    steps: d.steps,
    wornMin: d.wornMinutes,
    workouts: d.workouts.map(workoutView),
    walks: d.walks.map((w) => ({
      start: ms(w.startTime),
      end: ms(w.endTime),
      minutes: w.durationMinutes,
      steps: w.steps,
      cadence: w.cadence,
      briskMin: w.briskMinutes,
    })),
    lifting: d.lifting
      ? {
          exercises: d.lifting.exercises,
          sets: d.lifting.sets,
          volumeLb: d.lifting.volumePounds,
          matched: d.lifting.matched,
        }
      : null,
  }));
}

/** One workout with its heart rate and, for lifting, its sets. */
export async function fetchWorkout(token: Token, name: string): Promise<WorkoutDetail> {
  return workoutDetail(fromJson(WorkoutSchema, await call<JsonValue>(token, `/v1/${name}`)));
}

/** Say what a workout was: a kind, "none" for not a workout, or "" to take it back. */
export async function reviewWorkout(
  token: Token,
  name: string,
  kind: string,
): Promise<WorkoutDetail> {
  const body = JSON.stringify({ kind });
  const v = await call<JsonValue>(token, `/v1/${name}:review`, { method: "POST", body });
  return workoutDetail(fromJson(WorkoutSchema, v));
}

const STATUSES = {
  [WorkoutStatus.DETECTED]: "detected",
  [WorkoutStatus.POSSIBLE]: "possible",
  [WorkoutStatus.CONFIRMED]: "confirmed",
  [WorkoutStatus.DISMISSED]: "dismissed",
} as const;

function workoutView(w: Workout): WorkoutView {
  return {
    name: w.name,
    kind: w.kind,
    status: STATUSES[w.status as keyof typeof STATUSES] ?? "detected",
    start: ms(w.startTime),
    end: ms(w.endTime),
    minutes: w.durationMinutes,
    avgHr: w.averageHeartRate,
    maxHr: w.maxHeartRate,
    strain: w.strain,
  };
}

function workoutDetail(w: Workout): WorkoutDetail {
  return {
    ...workoutView(w),
    heartRate: w.heartRate,
    heartRateStart: ms(w.heartRateStartTime),
    sets: w.sets.map((s) => ({
      exercise: s.exercise,
      exerciseIndex: s.exerciseIndex,
      weight: s.weight ?? null,
      unit: s.unit,
      reps: s.reps,
      warmUp: s.warmUp,
      start: s.startTime ? ms(s.startTime) : null,
      peak: s.peakTime ? ms(s.peakTime) : null,
      peakHr: s.peakHeartRate ?? null,
    })),
  };
}

function dateQuery(field: string, date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  return `${field}.year=${year}&${field}.month=${month}&${field}.day=${day}`;
}

function pad(n: number | undefined): string {
  return String(n ?? 0).padStart(2, "0");
}

function ms(t: { seconds: bigint; nanos: number } | undefined): number {
  return Number(t?.seconds ?? 0n) * 1000 + Math.floor((t?.nanos ?? 0) / 1e6);
}
