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
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new ServiceError(body.message || `${path}: ${response.status}`);
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
          mapsUrl: v.nextEvent.mapsUri || null,
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
    mapsUrl: e.mapsUri || null,
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
  request: {
    text: string;
    requestId: string;
    kind?: "event" | "reminder";
    calendar?: string;
    /** The place the box showed for the line's "at …". */
    place?: PlaceView;
  },
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

/** One event as the event panel shows and edits it. */
export interface EventDetail {
  /** "events/{id}". */
  name: string;
  title: string;
  /** ISO times. */
  startTime: string;
  endTime: string;
  allDay: boolean;
  location: string;
  notes: string;
  writable: boolean;
  recurring: boolean;
  etag: string;
}

type EventJson = Partial<EventDetail> & { name: string };

function eventDetail(json: EventJson): EventDetail {
  return {
    name: json.name,
    title: json.title ?? "",
    startTime: json.startTime ?? "",
    endTime: json.endTime ?? "",
    allDay: json.allDay ?? false,
    location: json.location ?? "",
    notes: json.notes ?? "",
    writable: json.writable ?? false,
    recurring: json.recurring ?? false,
    etag: json.etag ?? "",
  };
}

export async function getEvent(token: Token, name: string): Promise<EventDetail> {
  return eventDetail(
    await call<EventJson>(token, "/dashboardify.v1.EventService/GetEvent", {
      method: "POST",
      body: JSON.stringify({ name }),
    }),
  );
}

/** Changes only the fields in `change`, and only if the event is still at `etag`. */
export async function updateEvent(
  token: Token,
  event: { name: string; etag: string },
  change: Partial<Pick<EventDetail, "title" | "startTime" | "endTime" | "location" | "notes">>,
): Promise<EventDetail> {
  return eventDetail(
    await call<EventJson>(token, "/dashboardify.v1.EventService/UpdateEvent", {
      method: "POST",
      body: JSON.stringify({
        event: { ...change, name: event.name, etag: event.etag },
        updateMask: Object.keys(change).join(","),
      }),
    }),
  );
}

/**
 * Deletes an event: Undo for one the capture box just added, or Delete in the event panel.
 * `name` is "events/{id}"; with `etag`, only if it hasn't changed since.
 */
export function deleteEvent(token: Token, name: string, etag?: string): Promise<unknown> {
  return call(token, "/dashboardify.v1.EventService/DeleteEvent", {
    method: "POST",
    body: JSON.stringify({ name, etag }),
  });
}

/** Undo for a task the capture box just added. `name` is "tasks/{id}". */
export function deleteTask(token: Token, name: string): Promise<unknown> {
  return call(token, "/dashboardify.v1.TaskService/DeleteTask", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** The server's settings, as the Settings page shows them. */
export interface SettingsView {
  timeZone: string;
  tasksInbox: string;
  tailnet: { proxy: string; allowedLogins: string[] };
  /** Place searches look near here first. */
  placesNear?: PlaceView;
  etag: string;
  /** Fields still set in .env, such as "time_zone". */
  envOverrides: string[];
  /** Fields the last change needs a restart for. */
  restartRequired: string[];
}

type SettingsJson = Partial<Omit<SettingsView, "tailnet">> & {
  tailnet?: { proxy?: string; allowedLogins?: string[] };
};

function settingsView(json: SettingsJson): SettingsView {
  return {
    timeZone: json.timeZone ?? "",
    tasksInbox: json.tasksInbox ?? "",
    tailnet: { proxy: json.tailnet?.proxy ?? "", allowedLogins: json.tailnet?.allowedLogins ?? [] },
    placesNear: json.placesNear && placeView(json.placesNear),
    etag: json.etag ?? "",
    envOverrides: json.envOverrides ?? [],
    restartRequired: json.restartRequired ?? [],
  };
}

export async function getSettings(token: Token): Promise<SettingsView> {
  return settingsView(
    await call<SettingsJson>(token, "/dashboardify.v1.SettingsService/GetSettings", {
      method: "POST",
      body: JSON.stringify({ name: "settings" }),
    }),
  );
}

/** Changes the given fields only, e.g. `{ timeZone: "Europe/London" }`. */
export async function updateSettings(
  token: Token,
  change: Partial<Pick<SettingsView, "timeZone" | "tasksInbox" | "tailnet" | "placesNear">>,
): Promise<SettingsView> {
  return settingsView(
    await call<SettingsJson>(token, "/dashboardify.v1.SettingsService/UpdateSettings", {
      method: "POST",
      body: JSON.stringify({
        settings: { name: "settings", ...change },
        updateMask: Object.keys(change).join(","),
      }),
    }),
  );
}

/** A real place, from place search. */
export interface PlaceView {
  displayName: string;
  address: string;
  location: { latitude: number; longitude: number };
  mapsUri: string;
}

function placeView(json: Partial<PlaceView>): PlaceView {
  return {
    displayName: json.displayName ?? "",
    address: json.address ?? "",
    location: {
      latitude: json.location?.latitude ?? 0,
      longitude: json.location?.longitude ?? 0,
    },
    mapsUri: json.mapsUri ?? "",
  };
}

/** Places matching what was typed, nearest to Settings' places_near first. */
export async function searchPlaces(token: Token, query: string): Promise<PlaceView[]> {
  const { places } = await call<{ places?: Partial<PlaceView>[] }>(
    token,
    "/dashboardify.v1.PlaceService/SearchPlaces",
    { method: "POST", body: JSON.stringify({ query }) },
  );
  return (places ?? []).map(placeView);
}

export interface DeviceView {
  /** "devices/{id}" */
  name: string;
  displayName: string;
  createTime: string;
  lastUsedTime?: string;
  /** The device making this request. */
  current: boolean;
}

export async function listDevices(token: Token): Promise<DeviceView[]> {
  const { devices } = await call<{ devices?: Partial<DeviceView>[] }>(
    token,
    "/dashboardify.v1.DeviceService/ListDevices",
    { method: "POST", body: "{}" },
  );
  return (devices ?? []).map((d) => ({
    name: d.name ?? "",
    displayName: d.displayName ?? "",
    createTime: d.createTime ?? "",
    lastUsedTime: d.lastUsedTime,
    current: d.current ?? false,
  }));
}

/** Adds a device; the response's token is the only time it is shown. */
export async function createDevice(
  token: Token,
  displayName: string,
  requestId: string,
): Promise<{ name: string; displayName: string; token: string }> {
  return call(token, "/dashboardify.v1.DeviceService/CreateDevice", {
    method: "POST",
    body: JSON.stringify({ device: { displayName }, requestId }),
  });
}

export function deleteDevice(token: Token, name: string): Promise<unknown> {
  return call(token, "/dashboardify.v1.DeviceService/DeleteDevice", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

export type CalendarCategory =
  | "work"
  | "fitness"
  | "personal"
  | "relationships"
  | "family"
  | "focus";

export interface CalendarAccountView {
  /** "calendarAccounts/{id}" */
  name: string;
  kind: "KIND_CALDAV" | "KIND_ICS";
  /** Links: the URL's host, the only part of it shown. */
  feedHost?: string;
  displayName: string;
  username: string;
  status: "STATUS_OK" | "STATUS_AUTH_FAILED" | "STATUS_UNREACHABLE";
  statusDetail?: string;
  lastSyncTime?: string;
}

export interface CalendarView {
  /** "calendarAccounts/{a}/calendars/{c}"; empty in a preview */
  name: string;
  displayName: string;
  serverColor?: string;
  category: CalendarCategory;
  enabled: boolean;
  forceReadOnly: boolean;
  writable: boolean;
}

export interface CalendarPreferencesView {
  defaultCalendar: string;
  keywordRules: { words: string[]; calendar: string }[];
}

type Json = Record<string, unknown>;

function rpc<T>(token: Token, method: string, body: Json): Promise<T> {
  return call<T>(token, `/dashboardify.v1.CalendarAccountService/${method}`, {
    method: "POST",
    body: JSON.stringify(body),
  });
}

function calendarView(c: Partial<CalendarView>): CalendarView {
  return {
    name: c.name ?? "",
    displayName: c.displayName ?? "",
    serverColor: c.serverColor,
    category: c.category ?? "personal",
    enabled: c.enabled ?? false,
    forceReadOnly: c.forceReadOnly ?? false,
    writable: c.writable ?? false,
  };
}

function accountView(a: Partial<CalendarAccountView>): CalendarAccountView {
  return {
    name: a.name ?? "",
    kind: a.kind ?? "KIND_CALDAV",
    feedHost: a.feedHost,
    displayName: a.displayName ?? "iCloud",
    username: a.username ?? "",
    status: a.status ?? "STATUS_OK",
    statusDetail: a.statusDetail,
    lastSyncTime: a.lastSyncTime,
  };
}

export async function listCalendarAccounts(token: Token): Promise<CalendarAccountView[]> {
  const r = await rpc<{ calendarAccounts?: Partial<CalendarAccountView>[] }>(
    token,
    "ListCalendarAccounts",
    {},
  );
  return (r.calendarAccounts ?? []).map(accountView);
}

/** Signs in to iCloud. With `validateOnly`, saves nothing and returns what it found. */
export async function connectICloud(
  token: Token,
  login: { username: string; password: string },
  validateOnly: boolean,
): Promise<{ account: CalendarAccountView; calendars: CalendarView[] }> {
  const r = await rpc<Partial<CalendarAccountView> & { calendars?: Partial<CalendarView>[] }>(
    token,
    "CreateCalendarAccount",
    { calendarAccount: { kind: "KIND_CALDAV", provider: "icloud", ...login }, validateOnly },
  );
  return { account: accountView(r), calendars: (r.calendars ?? []).map(calendarView) };
}

/** Checks a calendar link (`validateOnly`) or adds it. The URL is never sent back. */
export async function addCalendarLink(
  token: Token,
  link: { feedUrl: string; displayName?: string },
  validateOnly: boolean,
): Promise<{ account: CalendarAccountView; calendars: CalendarView[]; eventCount: number }> {
  const r = await rpc<
    Partial<CalendarAccountView> & { calendars?: Partial<CalendarView>[]; eventCount?: number }
  >(token, "CreateCalendarAccount", {
    calendarAccount: { kind: "KIND_ICS", ...link },
    validateOnly,
  });
  return {
    account: accountView(r),
    calendars: (r.calendars ?? []).map(calendarView),
    eventCount: r.eventCount ?? 0,
  };
}

export async function replaceLink(
  token: Token,
  account: string,
  feedUrl: string,
): Promise<CalendarAccountView> {
  return accountView(
    await rpc(token, "UpdateCalendarAccount", {
      calendarAccount: { name: account, feedUrl },
      updateMask: "feedUrl",
    }),
  );
}

export async function replacePassword(
  token: Token,
  account: string,
  password: string,
): Promise<CalendarAccountView> {
  return accountView(
    await rpc(token, "UpdateCalendarAccount", {
      calendarAccount: { name: account, password },
      updateMask: "password",
    }),
  );
}

export async function syncCalendarAccount(
  token: Token,
  account: string,
): Promise<CalendarAccountView> {
  return accountView(await rpc(token, "SyncCalendarAccount", { name: account }));
}

export function deleteCalendarAccount(token: Token, account: string): Promise<unknown> {
  return rpc(token, "DeleteCalendarAccount", { name: account });
}

export async function listCalendars(token: Token, account: string): Promise<CalendarView[]> {
  const r = await rpc<{ calendars?: Partial<CalendarView>[] }>(token, "ListCalendars", {
    parent: account,
  });
  return (r.calendars ?? []).map(calendarView);
}

export async function updateCalendar(
  token: Token,
  name: string,
  change: Partial<Pick<CalendarView, "category" | "enabled" | "forceReadOnly">>,
): Promise<CalendarView> {
  return calendarView(
    await rpc(token, "UpdateCalendar", {
      calendar: { name, ...change },
      updateMask: Object.keys(change).join(","),
    }),
  );
}

export async function getCalendarPreferences(token: Token): Promise<CalendarPreferencesView> {
  const r = await rpc<Partial<CalendarPreferencesView>>(token, "GetCalendarSettings", {
    name: "calendarSettings",
  });
  return { defaultCalendar: r.defaultCalendar ?? "", keywordRules: r.keywordRules ?? [] };
}

export async function updateCalendarPreferences(
  token: Token,
  change: Partial<CalendarPreferencesView>,
): Promise<CalendarPreferencesView> {
  const r = await rpc<Partial<CalendarPreferencesView>>(token, "UpdateCalendarSettings", {
    calendarSettings: { name: "calendarSettings", ...change },
    updateMask: Object.keys(change).join(","),
  });
  return { defaultCalendar: r.defaultCalendar ?? "", keywordRules: r.keywordRules ?? [] };
}

/** The error a service sent ("time_zone is set by TZ_NAME in .env…"), to show beside a field. */
export class ServiceError extends Error {}

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
