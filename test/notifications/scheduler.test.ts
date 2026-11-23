import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { createECDH, randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { CalendarEvent } from "../../src/home/calendar";
import { Notifier } from "../../src/notifications/notifier";
import { PushStore } from "../../src/notifications/push-store";
import { ReminderScheduler } from "../../src/notifications/scheduler";
import { DeviceStore } from "../../src/settings/devices";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";
import type { FoundTask } from "../../src/vault/task-store";

const key = randomBytes(32);
const at = (iso: string) => Date.parse(iso);

let dir: string;
let settings: SettingsStore;
let clock: number;
let answer: number;
let pushed: string[];
let events: CalendarEvent[];
let tasks: FoundTask[];
let taskReads: number;

const standup: CalendarEvent = {
  title: "Standup",
  start: at("2026-11-23T10:00:00Z"),
  end: at("2026-11-23T10:30:00Z"),
  category: "work",
  event: "events/abc",
} as CalendarEvent;

function browser(endpoint: string) {
  const ecdh = createECDH("prime256v1");
  ecdh.generateKeys();
  return {
    endpoint,
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
    displayName: "iPhone",
    subject: "https://dash.example.ts.net",
  };
}

/** A scheduler on the test's settings.db, as a restart would make it. */
function scheduler(): ReminderScheduler {
  const notifier = new Notifier(
    new PushStore(settings),
    (request) => {
      pushed.push(request.url);
      return Promise.resolve(new Response(null, { status: answer }));
    },
    () => undefined,
  );
  return new ReminderScheduler({
    notifier,
    calendar: {
      events: (from, to) => Promise.resolve(events.filter((e) => e.start < to && e.end > from)),
    },
    tasks: {
      list: () => {
        taskReads += 1;
        return Promise.resolve(tasks);
      },
    },
    timeZone: "UTC",
    now: () => clock,
    log: () => undefined,
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "reminders-"));
  settings = await SettingsStore.open(dir, new SecretBox(key));
  new DeviceStore(settings).add("phone", "secret");
  new PushStore(settings).subscribe("phone", browser("https://web.push.apple.com/one"));
  clock = at("2026-11-23T09:00:10Z");
  answer = 201;
  pushed = [];
  events = [standup];
  tasks = [];
  taskReads = 0;
});

afterEach(async () => {
  settings.close();
  await rm(dir, { recursive: true, force: true });
});

describe("ReminderScheduler", () => {
  test("sends each reminder once, however often it checks", async () => {
    const reminders = scheduler();

    const first = await reminders.check();
    clock += 30_000;
    const second = await reminders.check();

    expect(first).toBe(1);
    expect(second).toBe(0);
    expect(pushed).toEqual(["https://web.push.apple.com/one"]);
  });

  test("a restart doesn't send it again", async () => {
    await scheduler().check();
    settings.close();
    settings = await SettingsStore.open(dir, new SecretBox(key));

    clock += 60_000;
    const afterRestart = await scheduler().check();

    expect(afterRestart).toBe(0);
    expect(pushed).toHaveLength(1);
  });

  test("a restart up to 15 minutes late still sends it", async () => {
    clock = at("2026-11-23T09:14:00Z");

    expect(await scheduler().check()).toBe(1);
  });

  test("goes to every browser", async () => {
    new PushStore(settings).subscribe(
      "tailnet:me@github",
      browser("https://fcm.googleapis.com/fcm/send/x"),
    );

    await scheduler().check();

    expect(pushed.sort()).toEqual([
      "https://fcm.googleapis.com/fcm/send/x",
      "https://web.push.apple.com/one",
    ]);
  });

  test("a push that failed everywhere is tried again on the next check", async () => {
    const reminders = scheduler();
    answer = 503;

    expect(await reminders.check()).toBe(0);
    answer = 201;
    clock += 30_000;

    expect(await reminders.check()).toBe(1);
    expect(pushed).toHaveLength(2);
  });

  test("a browser that is gone is dropped", async () => {
    answer = 410;

    await scheduler().check();

    expect(new PushStore(settings).list()).toEqual([]);
  });

  test("with no browsers it reads nothing", async () => {
    new PushStore(settings).remove(new PushStore(settings).list()[0]?.id ?? "");
    tasks = [
      {
        ref: "a",
        path: "Inbox.md",
        task: { done: false, description: "x", due: "2026-11-23", time: "09:00" },
      },
    ];

    expect(await scheduler().check()).toBe(0);
    expect(taskReads).toBe(0);
  });

  test("tasks at their time, reading the vault at most once a minute", async () => {
    events = [];
    tasks = [
      {
        ref: "k7f3a2",
        path: "Inbox.md",
        task: { done: false, description: "Call the bank", due: "2026-11-23", time: "09:01" },
      },
    ];
    const reminders = scheduler();

    await reminders.check();
    clock = at("2026-11-23T09:00:40Z");
    await reminders.check();
    clock = at("2026-11-23T09:01:10Z");
    const sent = await reminders.check();

    expect(sent).toBe(1);
    expect(taskReads).toBe(2);
  });
});
