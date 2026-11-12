// Keeps strava-cache.db in step with Strava. Every 30 minutes it lists your activities from two
// days before the newest cached run, so late uploads, edits and deletions in that window are
// seen; the first pass goes back 90 days. Strava has no webhook we can receive on the tailnet.

import { localDate } from "../vault/time";
import type { StravaAccounts } from "./account";
import type { Run, RunCache } from "./cache";
import { StravaAuthFailed, type StravaClient } from "./client";

const DAY_MS = 86_400_000;
const POLL_MS = 30 * 60_000;
const MAX_BACKOFF_MS = 6 * 60 * 60_000;
const OVERLAP_MS = 2 * DAY_MS;
const FIRST_MS = 90 * DAY_MS;
/** Strava's largest page. */
const PAGE = 200;

/** Running on foot, outdoors or on a treadmill. */
const RUN_TYPES = new Set(["Run", "TrailRun", "VirtualRun"]);

export interface SyncDeps {
  accounts: StravaAccounts;
  cache: RunCache;
  client: Pick<StravaClient, "get">;
  timeZone: string;
  /** Local dates (YYYY-MM-DD) whose runs changed, oldest first, to recompute. */
  onChanged: (dates: string[]) => void;
  now?: () => number;
  log?: (message: string) => void;
}

/** The parts of Strava's SummaryActivity this reads. */
interface Activity {
  id: number;
  name: string;
  sport_type: string;
  start_date: string;
  elapsed_time: number;
  moving_time: number;
  distance: number;
  athlete: { id: number };
}

export class StravaSync {
  private readonly now: () => number;
  private readonly log: (message: string) => void;
  private backoff?: { until: number; wait: number };
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? Date.now;
    this.log = deps.log ?? console.warn;
  }

  start(intervalMs = POLL_MS): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One pass. Overlapping calls share the pass already running. */
  tick(): Promise<void> {
    this.running ??= this.pass().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  private async pass(): Promise<void> {
    const account = this.deps.accounts.get();
    // Disconnected, or connected as someone else: their runs no longer apply.
    this.changed(this.deps.cache.keepOnly(account?.athleteId));
    // A refused token stops polling until you connect again.
    if (!account || account.status === "auth_failed") {
      return;
    }
    if (this.backoff && this.now() < this.backoff.until) {
      return;
    }
    const newest = this.deps.cache.newest();
    const from = newest === undefined ? this.now() - FIRST_MS : newest - OVERLAP_MS;
    try {
      const runs = await this.list(from);
      this.changed(this.deps.cache.replaceFrom(from, runs));
      this.deps.accounts.synced();
      this.backoff = undefined;
    } catch (error) {
      if (error instanceof StravaAuthFailed) {
        this.log(`Strava: ${error.message}`);
        return;
      }
      const wait = Math.min((this.backoff?.wait ?? POLL_MS / 2) * 2, MAX_BACKOFF_MS);
      this.backoff = { until: this.now() + wait, wait };
      this.log(`Strava sync failed, retrying in ${wait / 60_000} min: ${(error as Error).message}`);
    }
  }

  /** Every run that starts from `from` on, across pages. */
  private async list(from: number): Promise<Run[]> {
    const runs: Run[] = [];
    for (let page = 1; ; page++) {
      const activities = await this.deps.client.get<Activity[]>("/athlete/activities", {
        after: String(Math.floor(from / 1000)),
        per_page: String(PAGE),
        page: String(page),
      });
      runs.push(...activities.filter((a) => RUN_TYPES.has(a.sport_type)).map(toRun));
      if (activities.length < PAGE) {
        return runs;
      }
    }
  }

  private changed(runs: Run[]): void {
    const dates = new Set(runs.map((run) => localDate(new Date(run.start), this.deps.timeZone)));
    if (dates.size > 0) {
      this.deps.onChanged([...dates].sort());
    }
  }
}

function toRun(a: Activity): Run {
  return {
    id: a.id,
    athleteId: a.athlete.id,
    name: a.name,
    sportType: a.sport_type,
    start: Date.parse(a.start_date),
    elapsedSeconds: a.elapsed_time,
    movingSeconds: a.moving_time,
    distanceMeters: a.distance,
  };
}
