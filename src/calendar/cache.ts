// calendar-cache.db: what the calendar server last said, so the home screen never waits on it.
// It is derived and disposable: deleting the file makes the next sync fetch everything again.
// Each .ics resource is kept whole with its etag, beside the occurrences expanded from it.

import { Database } from "bun:sqlite";
import { createHash } from "node:crypto";
import { chmod, mkdir } from "node:fs/promises";
import { join } from "node:path";
import { titleKey } from "../capture/choose-calendar";
import type { Occurrence } from "./ical";

/** Bump when the tables change; an older file is dropped and rebuilt by the next sync. */
const SCHEMA_VERSION = 1;

export interface SyncState {
  ctag?: string;
  syncToken?: string;
  lastSyncTime?: string;
  lastError?: string;
}

/** An occurrence as stored, with where it came from. */
export interface CachedEvent extends Occurrence {
  eventId: string;
  accountId: string;
  calendarId: string;
  href: string;
}

/** What the reader needs to know about each calendar: "<account>/<calendar>" → info. */
export type CalendarInfo = Map<string, { writable: boolean; enabled: boolean; sort: number }>;

interface OccurrenceRow {
  event_id: string;
  account_id: string;
  calendar_id: string;
  href: string;
  uid: string;
  recurrence_id: string | null;
  title: string;
  location: string;
  notes: string;
  url: string;
  start_ms: number;
  end_ms: number;
  all_day: number;
  start_date: string | null;
  end_date: string | null;
  recurring: number;
  tzid: string | null;
}

export class EventCache {
  private constructor(readonly db: Database) {}

  static async open(dataPath: string): Promise<EventCache> {
    await mkdir(dataPath, { recursive: true, mode: 0o700 });
    const path = join(dataPath, "calendar-cache.db");
    const db = new Database(path, { create: true, strict: true });
    await chmod(path, 0o600);
    db.run("PRAGMA journal_mode = WAL");
    const version = db.query<{ user_version: number }, []>("PRAGMA user_version").get();
    if (version?.user_version !== SCHEMA_VERSION) {
      createTables(db);
    }
    return new EventCache(db);
  }

  close(): void {
    this.db.close();
  }

  state(accountId: string, calendarId: string): SyncState {
    const row = this.db
      .query<
        {
          ctag: string | null;
          sync_token: string | null;
          last_sync_time: string | null;
          last_error: string | null;
        },
        [string, string]
      >(
        "SELECT ctag, sync_token, last_sync_time, last_error FROM sync_state WHERE account_id = ? AND calendar_id = ?",
      )
      .get(accountId, calendarId);
    return {
      ctag: row?.ctag ?? undefined,
      syncToken: row?.sync_token ?? undefined,
      lastSyncTime: row?.last_sync_time ?? undefined,
      lastError: row?.last_error ?? undefined,
    };
  }

  setState(accountId: string, calendarId: string, state: SyncState): void {
    this.db
      .query(
        `INSERT INTO sync_state (account_id, calendar_id, ctag, sync_token, last_sync_time, last_error)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT (account_id, calendar_id) DO UPDATE SET ctag = excluded.ctag,
           sync_token = excluded.sync_token, last_sync_time = excluded.last_sync_time,
           last_error = excluded.last_error`,
      )
      .run(
        accountId,
        calendarId,
        state.ctag ?? null,
        state.syncToken ?? null,
        state.lastSyncTime ?? null,
        state.lastError ?? null,
      );
  }

  /** href → etag for every stored resource of a calendar. */
  etags(accountId: string, calendarId: string): Map<string, string> {
    const rows = this.db
      .query<{ href: string; etag: string }, [string, string]>(
        "SELECT href, etag FROM resources WHERE account_id = ? AND calendar_id = ?",
      )
      .all(accountId, calendarId);
    return new Map(rows.map((row) => [row.href, row.etag]));
  }

  /** One stored resource: its etag and text, for editing it. */
  resource(
    accountId: string,
    calendarId: string,
    href: string,
  ): { etag: string; ics: string } | undefined {
    return (
      this.db
        .query<{ etag: string; ics: string }, [string, string, string]>(
          "SELECT etag, ics FROM resources WHERE account_id = ? AND calendar_id = ? AND href = ?",
        )
        .get(accountId, calendarId, href) ?? undefined
    );
  }

  /** Every stored resource, for expanding again into a new window. */
  resources(): {
    accountId: string;
    calendarId: string;
    href: string;
    etag: string;
    ics: string;
  }[] {
    return this.db
      .query<
        { account_id: string; calendar_id: string; href: string; etag: string; ics: string },
        []
      >("SELECT account_id, calendar_id, href, etag, ics FROM resources")
      .all()
      .map((row) => ({
        accountId: row.account_id,
        calendarId: row.calendar_id,
        href: row.href,
        etag: row.etag,
        ics: row.ics,
      }));
  }

  /** Stores a resource and replaces its occurrences, in one transaction. */
  put(
    resource: { accountId: string; calendarId: string; href: string; etag: string; ics: string },
    occurrences: Occurrence[],
  ): void {
    const { accountId, calendarId, href } = resource;
    this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO resources (account_id, calendar_id, href, etag, ics) VALUES (?, ?, ?, ?, ?)
           ON CONFLICT (account_id, calendar_id, href) DO UPDATE SET etag = excluded.etag, ics = excluded.ics`,
        )
        .run(accountId, calendarId, href, resource.etag, resource.ics);
      this.deleteOccurrences(accountId, calendarId, href);
      const insert = this.db.query(
        `INSERT OR REPLACE INTO occurrences (event_id, account_id, calendar_id, href, uid, recurrence_id,
           title, title_key, location, notes, url, start_ms, end_ms, all_day, start_date, end_date, recurring, tzid)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const o of occurrences) {
        insert.run(
          eventId(accountId, calendarId, o.uid, o.recurrenceId),
          accountId,
          calendarId,
          href,
          o.uid,
          o.recurrenceId ?? null,
          o.title,
          titleKey(o.title),
          o.location,
          o.notes,
          o.url,
          o.start.getTime(),
          o.end.getTime(),
          Number(o.allDay),
          o.startDate ?? null,
          o.endDate ?? null,
          Number(o.recurring),
          o.timeZone ?? null,
        );
      }
    })();
  }

  remove(accountId: string, calendarId: string, href: string): void {
    this.db.transaction(() => {
      this.db
        .query("DELETE FROM resources WHERE account_id = ? AND calendar_id = ? AND href = ?")
        .run(accountId, calendarId, href);
      this.deleteOccurrences(accountId, calendarId, href);
    })();
  }

  /** Forgets a calendar (or, with no calendar, a whole account) that no longer exists. */
  forget(accountId: string, calendarId?: string): void {
    const where = calendarId ? "account_id = ? AND calendar_id = ?" : "account_id = ?";
    const args = calendarId ? [accountId, calendarId] : [accountId];
    this.db.transaction(() => {
      for (const table of ["sync_state", "resources", "occurrences"]) {
        this.db.query(`DELETE FROM ${table} WHERE ${where}`).run(...args);
      }
    })();
  }

  /**
   * Occurrences overlapping [from, to) on enabled calendars, by start time. An event on several
   * calendars (same UID and recurrence-id) appears once: the writable copy, else the first
   * calendar in Settings order.
   */
  between(from: Date, to: Date, calendars: CalendarInfo): CachedEvent[] {
    const rows = this.db
      .query<OccurrenceRow, [number, number]>(
        "SELECT * FROM occurrences WHERE end_ms > ? AND start_ms < ? ORDER BY start_ms, event_id",
      )
      .all(from.getTime(), to.getTime());
    const best = new Map<string, OccurrenceRow>();
    for (const row of rows) {
      const info = calendars.get(`${row.account_id}/${row.calendar_id}`);
      if (!info?.enabled) {
        continue;
      }
      const key = `${row.uid}\u0000${row.recurrence_id ?? ""}`;
      const held = best.get(key);
      if (!held || better(info, calendars.get(`${held.account_id}/${held.calendar_id}`))) {
        best.set(key, row);
      }
    }
    return [...best.values()].sort((a, b) => a.start_ms - b.start_ms).map(toEvent);
  }

  /** How often each title was on each calendar in [since, until), most frequent first. */
  titleCounts(
    since: Date,
    until: Date,
    limit: number,
  ): { titleKey: string; accountId: string; calendarId: string; count: number; lastMs: number }[] {
    return this.db
      .query<
        { title_key: string; account_id: string; calendar_id: string; n: number; last_ms: number },
        [number, number, number]
      >(
        `SELECT title_key, account_id, calendar_id, count(*) AS n, max(start_ms) AS last_ms
         FROM occurrences WHERE start_ms >= ? AND start_ms < ? AND title_key != ''
         GROUP BY title_key, account_id, calendar_id ORDER BY n DESC, last_ms DESC LIMIT ?`,
      )
      .all(since.getTime(), until.getTime(), limit)
      .map((row) => ({
        titleKey: row.title_key,
        accountId: row.account_id,
        calendarId: row.calendar_id,
        count: row.n,
        lastMs: row.last_ms,
      }));
  }

  get(eventIdValue: string): CachedEvent | undefined {
    const row = this.db
      .query<OccurrenceRow, [string]>("SELECT * FROM occurrences WHERE event_id = ?")
      .get(eventIdValue);
    return row ? toEvent(row) : undefined;
  }

  private deleteOccurrences(accountId: string, calendarId: string, href: string): void {
    this.db
      .query("DELETE FROM occurrences WHERE account_id = ? AND calendar_id = ? AND href = ?")
      .run(accountId, calendarId, href);
  }
}

function better(
  candidate: { writable: boolean; sort: number },
  held: { writable: boolean; sort: number } | undefined,
): boolean {
  if (!held || candidate.writable !== held.writable) {
    return candidate.writable;
  }
  return candidate.sort < held.sort;
}

const BASE32 = "abcdefghijklmnopqrstuvwxyz234567";

/**
 * A stable id for one occurrence: the first 16 base32 characters of SHA-256 over
 * "account/calendar/uid/recurrence-id". The client can work it out before the server answers.
 */
export function eventId(
  accountId: string,
  calendarId: string,
  uid: string,
  recurrenceId: string | undefined,
): string {
  const digest = createHash("sha256")
    .update(`${accountId}/${calendarId}/${uid}/${recurrenceId ?? ""}`)
    .digest();
  let bits = 0;
  let value = 0;
  let out = "";
  for (const byte of digest) {
    value = (value << 8) | byte;
    bits += 8;
    while (bits >= 5 && out.length < 16) {
      out += BASE32[(value >>> (bits - 5)) & 31];
      bits -= 5;
    }
  }
  return out;
}

function toEvent(row: OccurrenceRow): CachedEvent {
  return {
    eventId: row.event_id,
    accountId: row.account_id,
    calendarId: row.calendar_id,
    href: row.href,
    uid: row.uid,
    recurrenceId: row.recurrence_id ?? undefined,
    title: row.title,
    location: row.location,
    notes: row.notes,
    url: row.url,
    start: new Date(row.start_ms),
    end: new Date(row.end_ms),
    allDay: row.all_day === 1,
    startDate: row.start_date ?? undefined,
    endDate: row.end_date ?? undefined,
    timeZone: row.tzid ?? undefined,
    recurring: row.recurring === 1,
  };
}

function createTables(db: Database): void {
  db.transaction(() => {
    for (const table of ["sync_state", "resources", "occurrences"]) {
      db.run(`DROP TABLE IF EXISTS ${table}`);
    }
    db.run(`CREATE TABLE sync_state (account_id TEXT NOT NULL, calendar_id TEXT NOT NULL, ctag TEXT,
      sync_token TEXT, last_sync_time TEXT, last_error TEXT, PRIMARY KEY (account_id, calendar_id))`);
    db.run(`CREATE TABLE resources (account_id TEXT NOT NULL, calendar_id TEXT NOT NULL,
      href TEXT NOT NULL, etag TEXT NOT NULL, ics TEXT NOT NULL,
      PRIMARY KEY (account_id, calendar_id, href))`);
    db.run(`CREATE TABLE occurrences (event_id TEXT PRIMARY KEY, account_id TEXT NOT NULL,
      calendar_id TEXT NOT NULL, href TEXT NOT NULL, uid TEXT NOT NULL, recurrence_id TEXT,
      title TEXT NOT NULL, title_key TEXT NOT NULL, location TEXT NOT NULL, notes TEXT NOT NULL,
      url TEXT NOT NULL, start_ms INTEGER NOT NULL, end_ms INTEGER NOT NULL, all_day INTEGER NOT NULL,
      start_date TEXT, end_date TEXT, recurring INTEGER NOT NULL, tzid TEXT)`);
    db.run("CREATE INDEX occurrences_time ON occurrences (start_ms, end_ms)");
    db.run("CREATE INDEX occurrences_title ON occurrences (title_key)");
    db.run(`PRAGMA user_version = ${SCHEMA_VERSION}`);
  })();
}
