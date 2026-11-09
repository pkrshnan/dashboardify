// Keeps calendar-cache.db in step with iCloud. Every tick (2 minutes) it reads the accounts from
// settings.db, so an account added, removed or given a new password applies on the next tick.
// A quiet tick is one PROPFIND: calendars whose ctag hasn't moved are skipped. Changed ones use
// sync-collection, or a full etag comparison when the server has forgotten the token.

import type { ConnectCalDav } from "../server/api/calendar-accounts";
import type { Account, CalendarAccounts, StoredCalendar } from "./accounts";
import { calendarId } from "./accounts";
import type { EventCache } from "./cache";
import { type CalDavCalendar, type CalDavClient, type ResourceRef, Unauthorized } from "./caldav";
import { readOccurrences } from "./ical";

const DAY_MS = 86_400_000;
const POLL_MS = 2 * 60_000;
const MAX_BACKOFF_MS = 60 * 60_000;
/** multiget batch size: iCloud answers large batches slowly. */
const BATCH = 50;

export interface SyncDeps {
  accounts: CalendarAccounts;
  cache: EventCache;
  connect: ConnectCalDav;
  /** Floating times and all-day dates are read in this zone. */
  timeZone: string;
  now?: () => Date;
  log?: (message: string) => void;
  /** Called after every pass, e.g. to rewrite the daily note's agenda block. */
  onPass?: () => Promise<unknown>;
}

/** Occurrences are expanded from this far back (for the calendar guess's history)… */
export const WINDOW_BACK_MS = 180 * DAY_MS;
/** …to this far ahead. */
export const WINDOW_AHEAD_MS = 60 * DAY_MS;

export class CalendarSync {
  private readonly now: () => Date;
  private readonly log: (message: string) => void;
  /** Per account: when to try next after a failure, and how long the last wait was. */
  private readonly backoff = new Map<string, { until: number; wait: number }>();
  private timer?: ReturnType<typeof setInterval>;
  private running?: Promise<void>;
  private expandedDay = "";

  constructor(private readonly deps: SyncDeps) {
    this.now = deps.now ?? (() => new Date());
    this.log = deps.log ?? console.warn;
  }

  start(intervalMs = POLL_MS): void {
    this.timer = setInterval(() => this.tick(), intervalMs);
    this.tick();
  }

  stop(): void {
    clearInterval(this.timer);
  }

  /** One pass over every account. Overlapping calls share the pass already running. */
  tick(): Promise<void> {
    this.running ??= this.pass().finally(() => {
      this.running = undefined;
    });
    return this.running;
  }

  /** Syncs one calendar now, as after a write, so the cache has the server's etag. */
  async syncCalendar(accountId: string, id: string): Promise<void> {
    const account = this.deps.accounts.get(accountId);
    const calendar = this.deps.accounts.calendar(accountId, id);
    if (account && calendar) {
      await this.syncCollection(this.client(account), account, calendar);
    }
  }

  private async pass(): Promise<void> {
    this.reexpandDaily();
    const accounts = this.deps.accounts.list();
    for (const account of accounts) {
      await this.syncAccount(account);
    }
    await this.deps.onPass?.().catch((error) => this.log(`After sync: ${String(error)}`));
    const known = new Set(accounts.map((account) => account.id));
    for (const { accountId } of this.deps.cache.resources()) {
      if (!known.has(accountId)) {
        this.deps.cache.forget(accountId);
      }
    }
  }

  private async syncAccount(account: Account): Promise<void> {
    // A refused password stops polling until it is replaced, which sets the status back to ok.
    if (account.status === "auth_failed" || !account.homeUrl) {
      return;
    }
    const wait = this.backoff.get(account.id);
    if (wait && this.now().getTime() < wait.until) {
      return;
    }
    try {
      const client = this.client(account);
      const found = await client.listCalendars(account.homeUrl);
      this.refreshCalendars(account, found);
      for (const calendar of this.deps.accounts.calendars(account.id)) {
        const server = found.find((f) => calendarId(f.url) === calendar.id);
        if (
          calendar.enabled &&
          server &&
          server.ctag !== this.deps.cache.state(account.id, calendar.id).ctag
        ) {
          await this.syncCollection(client, account, calendar, server.ctag);
        }
      }
      this.succeeded(account);
    } catch (error) {
      this.failed(account, error);
    }
  }

  /** Keeps Settings' calendar list in step, writing only when something changed. */
  private refreshCalendars(account: Account, found: CalDavCalendar[]): void {
    const stored = this.deps.accounts.calendars(account.id);
    const same =
      stored.length === found.length &&
      found.every((f) => {
        const s = stored.find((c) => c.id === calendarId(f.url));
        return (
          s &&
          s.displayName === f.displayName &&
          s.serverWritable === f.writable &&
          s.serverColor === f.color
        );
      });
    if (!same) {
      this.deps.accounts.refreshCalendars(
        account.id,
        found.map((f) => ({
          href: f.url,
          displayName: f.displayName,
          color: f.color,
          writable: f.writable,
        })),
      );
      for (const calendar of stored) {
        if (!found.some((f) => calendarId(f.url) === calendar.id)) {
          this.deps.cache.forget(account.id, calendar.id);
        }
      }
    }
  }

  private async syncCollection(
    client: CalDavClient,
    account: Account,
    calendar: StoredCalendar,
    ctag?: string,
  ): Promise<void> {
    const state = this.deps.cache.state(account.id, calendar.id);
    const result = await client.sync(calendar.href, state.syncToken);
    let changes: { changed: ResourceRef[]; deleted: string[]; syncToken?: string };
    if (result.kind === "changes") {
      changes = result;
    } else {
      this.log(
        `${account.displayName}/${calendar.displayName}: sync token expired, comparing etags`,
      );
      changes = await this.compareAll(client, account.id, calendar);
    }
    await this.apply(client, account.id, calendar, changes);
    this.deps.cache.setState(account.id, calendar.id, {
      ctag: ctag ?? state.ctag,
      syncToken: changes.syncToken,
      lastSyncTime: this.now().toISOString(),
    });
  }

  /** Without a usable token: start over (every etag and a new token) and diff against the cache. */
  private async compareAll(client: CalDavClient, accountId: string, calendar: StoredCalendar) {
    const cached = this.deps.cache.etags(accountId, calendar.id);
    const fresh = await client.sync(calendar.href, undefined);
    const server =
      fresh.kind === "changes" ? fresh.changed : await client.listResources(calendar.href);
    const urls = new Set(server.map((r) => r.url));
    return {
      changed: server.filter((r) => cached.get(r.url) !== r.etag),
      deleted: [...cached.keys()].filter((url) => !urls.has(url)),
      syncToken: fresh.kind === "changes" ? fresh.syncToken : undefined,
    };
  }

  private async apply(
    client: CalDavClient,
    accountId: string,
    calendar: StoredCalendar,
    changes: { changed: ResourceRef[]; deleted: string[] },
  ): Promise<void> {
    for (const url of changes.deleted) {
      this.deps.cache.remove(accountId, calendar.id, url);
    }
    for (let i = 0; i < changes.changed.length; i += BATCH) {
      const urls = changes.changed.slice(i, i + BATCH).map((r) => r.url);
      for (const resource of await client.fetchResources(calendar.href, urls)) {
        this.store(accountId, calendar.id, resource.url, resource.etag, resource.ics);
      }
    }
  }

  private store(accountId: string, id: string, href: string, etag: string, ics: string): void {
    let occurrences: ReturnType<typeof readOccurrences> = [];
    try {
      occurrences = readOccurrences(ics, this.window());
    } catch (error) {
      // Keep the resource, so its etag stops it being fetched again, but show nothing for it.
      this.log(`Skipped an event in ${accountId}/${id} that couldn't be read: ${String(error)}`);
    }
    this.deps.cache.put({ accountId, calendarId: id, href, etag, ics }, occurrences);
  }

  /** The window moves a day at a time, so recurring events are expanded again once a day. */
  private reexpandDaily(): void {
    const day = this.now().toISOString().slice(0, 10);
    if (day === this.expandedDay) {
      return;
    }
    if (this.expandedDay) {
      for (const r of this.deps.cache.resources()) {
        this.store(r.accountId, r.calendarId, r.href, r.etag, r.ics);
      }
    }
    this.expandedDay = day;
  }

  private window() {
    const now = this.now().getTime();
    return {
      from: new Date(now - WINDOW_BACK_MS),
      to: new Date(now + WINDOW_AHEAD_MS),
      floatingZone: this.deps.timeZone,
    };
  }

  private client(account: Account): CalDavClient {
    return this.deps.connect({
      serverUrl: account.serverUrl,
      username: account.username,
      password: this.deps.accounts.password(account.id),
    });
  }

  private succeeded(account: Account): void {
    this.backoff.delete(account.id);
    if (account.status !== "ok") {
      this.deps.accounts.setStatus(account.id, "ok");
    }
  }

  private failed(account: Account, error: unknown): void {
    if (error instanceof Unauthorized) {
      this.deps.accounts.setStatus(
        account.id,
        "auth_failed",
        `Sign-in failed at ${this.now().toISOString()}. The app-specific password was revoked or changed.`,
      );
      this.log(
        `${account.displayName}: iCloud refused the password; polling stops until it is replaced`,
      );
      return;
    }
    const last = this.backoff.get(account.id)?.wait ?? POLL_MS / 2;
    const wait = Math.min(last * 2, MAX_BACKOFF_MS);
    this.backoff.set(account.id, { until: this.now().getTime() + wait, wait });
    this.deps.accounts.setStatus(
      account.id,
      "unreachable",
      error instanceof Error ? error.message : String(error),
    );
    this.log(
      `${account.displayName}: sync failed, retrying in ${Math.round(wait / 60_000)} min: ${String(error)}`,
    );
  }
}
