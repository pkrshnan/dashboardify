// Re-runs daily summaries after new strap data arrives. healthstrap uploads one file per stream
// per UTC day, in a burst; we wait for the burst to finish, then recompute every local date that
// data can affect, oldest first (each night's baseline reads the nights before it).

import { localDate } from "../vault/time";
import type { DailySummary } from "./daily-summary";

/** Long enough for one sync's uploads (a dozen streams, maybe several days) to all land. */
const SETTLE_MS = 2 * 60_000;
const DAY_MS = 86_400_000;

export class SummaryScheduler {
  private readonly pending = new Set<string>();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private queue: Promise<void> = Promise.resolve();

  constructor(
    private readonly summary: Pick<DailySummary, "run">,
    private readonly timeZone: string,
    private readonly settleMs = SETTLE_MS,
    private readonly now: () => number = Date.now,
  ) {}

  /** New data for a UTC day (YYYY-MM-DD) arrived. */
  touchUtcDay(day: string): void {
    const start = Date.parse(`${day}T00:00:00Z`);
    // The local dates the UTC day overlaps, plus the next one: its night starts the evening before.
    for (const ts of [start, start + DAY_MS - 1, start + DAY_MS - 1 + DAY_MS]) {
      this.add(localDate(new Date(ts), this.timeZone));
    }
    this.arm();
  }

  /** Recompute a local date (YYYY-MM-DD). */
  touchDate(date: string): void {
    this.add(date);
    this.arm();
  }

  /** Run everything pending now. Resolves when done; errors are logged, never thrown. */
  flush(): Promise<void> {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    const dates = [...this.pending].sort();
    this.pending.clear();
    this.queue = this.queue.then(() => this.runAll(dates));
    return this.queue;
  }

  private add(date: string): void {
    if (date <= localDate(new Date(this.now()), this.timeZone)) {
      this.pending.add(date);
    }
  }

  private arm(): void {
    if (this.timer) {
      clearTimeout(this.timer);
    }
    this.timer = setTimeout(() => void this.flush(), this.settleMs);
  }

  private async runAll(dates: string[]): Promise<void> {
    for (const date of dates) {
      try {
        await this.summary.run(date);
      } catch (err) {
        console.error(`health summary for ${date} failed:`, err);
      }
    }
  }
}
