// Talks to the server's /api. Opened through Tailscale, the server knows who you are and no
// token is needed. Anywhere else (local development, the demo) the server answers 401, and the
// sign-in screen asks for a device token, which is kept in localStorage.

import { fromJson, type JsonValue } from "@bufbuild/protobuf";
import { HomeSchema } from "../src/gen/dashboardify/v1/home_pb";
import type { HomeView } from "../src/home/types";

const TOKEN_KEY = "dashboardify.token";

export class Unauthorized extends Error {}

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
    throw new Unauthorized("unauthorized");
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
      events: d.events.map((e) => ({
        title: e.title,
        start: time(e.startTime),
        end: time(e.endTime),
        startMin: e.startMinute,
        endMin: e.endMinute,
        detail: e.detail,
        category: e.category as HomeView["days"][number]["events"][number]["category"],
        url: e.url || null,
      })),
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

/** The voice capture method also parses dates in typed text. */
export function addTask(token: Token, text: string): Promise<{ message: string }> {
  return call(token, "/dashboardify.v1.VoiceService/AddTask", {
    method: "POST",
    body: JSON.stringify({ requestId: randomKey(), text }),
  });
}

/** randomUUID needs HTTPS; over plain HTTP on the tailnet fall back to random bytes. */
function randomKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
