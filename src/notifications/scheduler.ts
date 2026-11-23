// Sends reminders as they fall due. Every 30 seconds it looks back over the last 15 minutes, so a
// restart or a calendar sync that brought an event late still sends it, and the sent log in
// settings.db stops anything going twice. A push that failed everywhere isn't logged, so it is
// tried again on the next check until it leaves the window.

import type { CalendarSource } from "../home/calendar";
import type { FoundTask } from "../vault/task-store";
import type { Notifier } from "./notifier";
import { dueReminders } from "./reminders";

const CHECK_EVERY_MS = 30_000;
const LATE_LIMIT_MS = 15 * 60_000;
/** Task times are whole minutes, so the vault is read at most this often. */
const TASKS_EVERY_MS = 60_000;
const MINUTE_MS = 60_000;

export interface SchedulerDeps {
  notifier: Notifier;
  calendar: CalendarSource;
  tasks: { list(): Promise<FoundTask[]> };
  timeZone: string;
  now?: () => number;
  log?: (line: string) => void;
}

export class ReminderScheduler {
  private running = false;
  private tasksRead: { at: number; tasks: FoundTask[] } | undefined;

  constructor(private readonly deps: SchedulerDeps) {}

  start(): void {
    setInterval(() => void this.check(), CHECK_EVERY_MS);
    void this.check();
  }

  /** Sends what is due now; returns how many reminders went. Errors are logged, never thrown. */
  async check(): Promise<number> {
    if (this.running) {
      return 0;
    }
    this.running = true;
    try {
      return await this.sendDue();
    } catch (error) {
      (this.deps.log ?? console.error)(`reminders: ${String(error)}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async sendDue(): Promise<number> {
    const { notifier, timeZone } = this.deps;
    const targets = notifier.store.targets();
    if (targets.length === 0) {
      return 0;
    }
    const now = this.now();
    const prefs = notifier.store.prefs();
    const ahead = Math.max(0, ...prefs.eventOffsets) * MINUTE_MS;
    const events = ahead > 0 ? await this.deps.calendar.events(now, now + ahead + MINUTE_MS) : [];
    const tasks = prefs.taskReminders ? await this.tasks(now) : [];
    const due = dueReminders(
      { from: now - LATE_LIMIT_MS, to: now },
      { events, tasks, prefs, timeZone },
    ).filter((reminder) => !notifier.store.wasSent(reminder.key));

    let sent = 0;
    for (const reminder of due) {
      const result = await notifier.push(targets, reminder.message, {
        ttl: reminder.ttl,
        urgency: "high",
      });
      if (result.sent > 0) {
        notifier.store.markSent(reminder.key);
        sent += 1;
      }
    }
    return sent;
  }

  private async tasks(now: number): Promise<FoundTask[]> {
    if (!this.tasksRead || now - this.tasksRead.at >= TASKS_EVERY_MS) {
      this.tasksRead = { at: now, tasks: await this.deps.tasks.list() };
    }
    return this.tasksRead.tasks;
  }

  private now(): number {
    return this.deps.now?.() ?? Date.now();
  }
}
