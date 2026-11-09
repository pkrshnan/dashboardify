// Calendar accounts and their calendars, in settings.db. The password is sealed with the
// SecretBox (AAD "calendar_accounts/<id>/password") and only ever opened to talk to the server.
// The table already has the columns calendar links (ICS URLs) will use, so they need no migration.

import { SettingsStore } from "../settings/store";

SettingsStore.register("calendar", [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE calendar_accounts (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        provider TEXT NOT NULL,
        display_name TEXT NOT NULL,
        server_url TEXT,
        home_url TEXT,
        username TEXT,
        password_sealed BLOB,
        feed_url_sealed BLOB,
        feed_host TEXT,
        http_etag TEXT,
        http_last_modified TEXT,
        last_used_time TEXT,
        last_sync_time TEXT,
        status TEXT NOT NULL DEFAULT 'ok',
        status_detail TEXT,
        create_time TEXT NOT NULL,
        update_time TEXT NOT NULL
      )`);
      db.run(
        "CREATE UNIQUE INDEX one_caldav_account ON calendar_accounts (kind) WHERE kind = 'caldav'",
      );
      db.run(`CREATE TABLE calendars (
        account_id TEXT NOT NULL REFERENCES calendar_accounts(id) ON DELETE CASCADE,
        id TEXT NOT NULL,
        href TEXT NOT NULL,
        display_name TEXT NOT NULL,
        server_color TEXT,
        category TEXT NOT NULL DEFAULT 'personal',
        server_writable INTEGER NOT NULL,
        force_read_only INTEGER NOT NULL DEFAULT 0,
        enabled INTEGER NOT NULL DEFAULT 1,
        sort INTEGER NOT NULL DEFAULT 0,
        PRIMARY KEY (account_id, id)
      )`);
      db.run(`CREATE TABLE calendar_settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        default_account_id TEXT,
        default_calendar_id TEXT,
        keyword_rules TEXT NOT NULL DEFAULT '[]'
      )`);
      db.run("INSERT INTO calendar_settings (id) VALUES (1)");
    },
  },
]);

SettingsStore.registerSealed("calendar_accounts", "id", ["password_sealed", "feed_url_sealed"]);

export type Category = "work" | "fitness" | "personal" | "focus";

export type AccountStatus = "ok" | "auth_failed" | "unreachable";

export interface Account {
  id: string;
  /** caldav: the iCloud account. ics: a calendar link, read-only, with one calendar. */
  kind: "caldav" | "ics";
  provider: string;
  displayName: string;
  serverUrl: string;
  homeUrl?: string;
  username: string;
  passwordSet: boolean;
  /** Links only: the URL's host, the only part of it ever shown. */
  feedHost?: string;
  lastUsedTime?: string;
  lastSyncTime?: string;
  status: AccountStatus;
  statusDetail?: string;
  createTime: string;
  updateTime: string;
}

export interface StoredCalendar {
  accountId: string;
  id: string;
  href: string;
  displayName: string;
  serverColor?: string;
  category: Category;
  serverWritable: boolean;
  forceReadOnly: boolean;
  enabled: boolean;
  sort: number;
}

/** A calendar as the server described it, before it is saved. */
export interface FoundCalendar {
  href: string;
  displayName: string;
  color?: string;
  writable: boolean;
}

export interface KeywordRule {
  words: string[];
  /** "<account>/<calendar>" */
  calendar: string;
}

export interface CalendarPreferences {
  /** "<account>/<calendar>" */
  defaultCalendar?: string;
  keywordRules: KeywordRule[];
}

export class AccountExists extends Error {}

interface AccountRow {
  id: string;
  kind: "caldav" | "ics";
  provider: string;
  display_name: string;
  server_url: string | null;
  home_url: string | null;
  username: string | null;
  password_sealed: Uint8Array | null;
  feed_host: string | null;
  last_used_time: string | null;
  last_sync_time: string | null;
  status: AccountStatus;
  status_detail: string | null;
  create_time: string;
  update_time: string;
}

interface CalendarRow {
  account_id: string;
  id: string;
  href: string;
  display_name: string;
  server_color: string | null;
  category: Category;
  server_writable: number;
  force_read_only: number;
  enabled: number;
  sort: number;
}

export interface NewAccount {
  id: string;
  provider: string;
  displayName: string;
  serverUrl: string;
  homeUrl: string;
  username: string;
  password: string;
}

export class CalendarAccounts {
  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  list(): Account[] {
    return this.store.db
      .query<AccountRow, []>("SELECT * FROM calendar_accounts ORDER BY create_time, rowid")
      .all()
      .map(toAccount);
  }

  get(id: string): Account | undefined {
    const row = this.store.db
      .query<AccountRow, [string]>("SELECT * FROM calendar_accounts WHERE id = ?")
      .get(id);
    return row ? toAccount(row) : undefined;
  }

  /** Saves an account and the calendars found for it, in one transaction. */
  create(account: NewAccount, calendars: FoundCalendar[]): Account {
    const time = this.now().toISOString();
    try {
      this.store.transaction((db) => {
        db.query(
          `INSERT INTO calendar_accounts (id, kind, provider, display_name, server_url, home_url,
            username, password_sealed, last_used_time, last_sync_time, create_time, update_time)
           VALUES (?, 'caldav', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          account.id,
          account.provider,
          account.displayName,
          account.serverUrl,
          account.homeUrl,
          account.username,
          this.seal(account.id, account.password),
          time,
          time,
          time,
          time,
        );
        this.saveCalendars(account.id, calendars);
      });
    } catch (error) {
      if (String(error).includes("UNIQUE")) {
        throw new AccountExists(
          "There is already an iCloud account. Remove it first to use another.",
        );
      }
      throw error;
    }
    return this.get(account.id) as Account;
  }

  /** Saves a calendar link as an account with one read-only calendar, "feed". */
  createLink(link: {
    id: string;
    displayName: string;
    url: string;
    host: string;
    category: Category;
  }): Account {
    const time = this.now().toISOString();
    this.store.transaction((db) => {
      db.query(
        `INSERT INTO calendar_accounts (id, kind, provider, display_name, feed_url_sealed, feed_host,
          create_time, update_time) VALUES (?, 'ics', 'url', ?, ?, ?, ?, ?)`,
      ).run(link.id, link.displayName, this.sealFeed(link.id, link.url), link.host, time, time);
      db.query(
        `INSERT INTO calendars (account_id, id, href, display_name, category, server_writable)
         VALUES (?, 'feed', 'feed', ?, ?, 0)`,
      ).run(link.id, link.displayName, link.category);
    });
    return this.get(link.id) as Account;
  }

  /** A link's URL, opened to fetch it. */
  feedUrl(id: string): string {
    const row = this.store.db
      .query<{ feed_url_sealed: Uint8Array | null }, [string]>(
        "SELECT feed_url_sealed FROM calendar_accounts WHERE id = ?",
      )
      .get(id);
    if (!row?.feed_url_sealed) {
      throw new Error(`No link stored for ${id}`);
    }
    return this.store.box.open(`calendar_accounts/${id}/feed_url_sealed`, row.feed_url_sealed);
  }

  /** Replaces a link's URL (and forgets the old one's cache validators), or renames it. */
  updateLink(id: string, change: { url?: string; host?: string; displayName?: string }): Account {
    const time = this.now().toISOString();
    this.store.transaction((db) => {
      if (change.url && change.host) {
        db.query(
          "UPDATE calendar_accounts SET feed_url_sealed = ?, feed_host = ?, http_etag = NULL, http_last_modified = NULL, status = 'ok', status_detail = NULL, update_time = ? WHERE id = ?",
        ).run(this.sealFeed(id, change.url), change.host, time, id);
      }
      if (change.displayName) {
        db.query("UPDATE calendar_accounts SET display_name = ?, update_time = ? WHERE id = ?").run(
          change.displayName,
          time,
          id,
        );
        db.query("UPDATE calendars SET display_name = ? WHERE account_id = ?").run(
          change.displayName,
          id,
        );
      }
    });
    return this.get(id) as Account;
  }

  /** The validators from the last fetch, for a conditional GET. */
  httpCache(id: string): { etag?: string; lastModified?: string } {
    const row = this.store.db
      .query<{ http_etag: string | null; http_last_modified: string | null }, [string]>(
        "SELECT http_etag, http_last_modified FROM calendar_accounts WHERE id = ?",
      )
      .get(id);
    return {
      etag: row?.http_etag ?? undefined,
      lastModified: row?.http_last_modified ?? undefined,
    };
  }

  /** A link fetched: keep its validators and mark it working. */
  linkFetched(id: string, cache: { etag?: string; lastModified?: string }): void {
    const time = this.now().toISOString();
    this.store.db
      .query(
        "UPDATE calendar_accounts SET http_etag = ?, http_last_modified = ?, last_sync_time = ?, last_used_time = ?, status = 'ok', status_detail = NULL WHERE id = ?",
      )
      .run(cache.etag ?? null, cache.lastModified ?? null, time, time, id);
  }

  /** The stored password, opened for a request to the server. */
  password(id: string): string {
    const row = this.store.db
      .query<{ password_sealed: Uint8Array | null }, [string]>(
        "SELECT password_sealed FROM calendar_accounts WHERE id = ?",
      )
      .get(id);
    if (!row?.password_sealed) {
      throw new Error(`No password stored for ${id}`);
    }
    return this.store.box.open(aad(id), row.password_sealed);
  }

  update(id: string, change: { displayName?: string; password?: string }): Account {
    const time = this.now().toISOString();
    this.store.transaction((db) => {
      if (change.displayName !== undefined) {
        db.query("UPDATE calendar_accounts SET display_name = ?, update_time = ? WHERE id = ?").run(
          change.displayName,
          time,
          id,
        );
      }
      if (change.password !== undefined) {
        db.query(
          "UPDATE calendar_accounts SET password_sealed = ?, status = 'ok', status_detail = NULL, last_used_time = ?, update_time = ? WHERE id = ?",
        ).run(this.seal(id, change.password), time, time, id);
      }
    });
    return this.get(id) as Account;
  }

  setStatus(id: string, status: AccountStatus, detail?: string): void {
    this.store.db
      .query("UPDATE calendar_accounts SET status = ?, status_detail = ? WHERE id = ?")
      .run(status, detail ?? null, id);
  }

  /** Removes the account and, through the foreign key, its calendars. */
  delete(id: string): boolean {
    return this.store.transaction((db) => {
      db.query(
        "UPDATE calendar_settings SET default_account_id = NULL, default_calendar_id = NULL WHERE default_account_id = ?",
      ).run(id);
      return db.query("DELETE FROM calendar_accounts WHERE id = ?").run(id).changes > 0;
    });
  }

  calendars(accountId: string): StoredCalendar[] {
    return this.store.db
      .query<CalendarRow, [string]>(
        "SELECT * FROM calendars WHERE account_id = ? ORDER BY sort, id",
      )
      .all(accountId)
      .map(toCalendar);
  }

  calendar(accountId: string, id: string): StoredCalendar | undefined {
    return this.calendars(accountId).find((calendar) => calendar.id === id);
  }

  /**
   * Brings the saved calendars in line with what the server now has: new ones are added with
   * a guessed category, renamed ones keep their settings, and removed ones are dropped.
   */
  refreshCalendars(accountId: string, found: FoundCalendar[]): void {
    const time = this.now().toISOString();
    this.store.transaction((db) => {
      this.saveCalendars(accountId, found);
      const ids = found.map((calendar) => calendarId(calendar.href));
      const placeholders = ids.map(() => "?").join(", ");
      db.query(
        `DELETE FROM calendars WHERE account_id = ? AND id NOT IN (${placeholders || "''"})`,
      ).run(accountId, ...ids);
      db.query(
        "UPDATE calendar_accounts SET last_sync_time = ?, last_used_time = ?, status = 'ok', status_detail = NULL WHERE id = ?",
      ).run(time, time, accountId);
    });
  }

  updateCalendar(
    accountId: string,
    id: string,
    change: Partial<Pick<StoredCalendar, "category" | "enabled" | "forceReadOnly">>,
  ): StoredCalendar {
    const current = this.calendar(accountId, id);
    if (!current) {
      throw new Error("calendar not found");
    }
    const next = { ...current, ...change };
    this.store.db
      .query(
        "UPDATE calendars SET category = ?, enabled = ?, force_read_only = ? WHERE account_id = ? AND id = ?",
      )
      .run(next.category, Number(next.enabled), Number(next.forceReadOnly), accountId, id);
    return this.calendar(accountId, id) as StoredCalendar;
  }

  preferences(): CalendarPreferences {
    const row = this.store.db
      .query<
        {
          default_account_id: string | null;
          default_calendar_id: string | null;
          keyword_rules: string;
        },
        []
      >(
        "SELECT default_account_id, default_calendar_id, keyword_rules FROM calendar_settings WHERE id = 1",
      )
      .get();
    const defaultCalendar =
      row?.default_account_id && row.default_calendar_id
        ? `${row.default_account_id}/${row.default_calendar_id}`
        : undefined;
    return { defaultCalendar, keywordRules: JSON.parse(row?.keyword_rules ?? "[]") };
  }

  setPreferences(preferences: CalendarPreferences): void {
    const [accountId, calendarIdPart] = preferences.defaultCalendar?.split("/") ?? [];
    this.store.db
      .query(
        "UPDATE calendar_settings SET default_account_id = ?, default_calendar_id = ?, keyword_rules = ? WHERE id = 1",
      )
      .run(accountId ?? null, calendarIdPart ?? null, JSON.stringify(preferences.keywordRules));
  }

  /** Whether new events can go on this calendar: the server allows it and it isn't locked here. */
  writable(accountId: string, id: string): boolean {
    const calendar = this.calendar(accountId, id);
    return Boolean(calendar?.serverWritable && !calendar.forceReadOnly);
  }

  private saveCalendars(accountId: string, found: FoundCalendar[]): void {
    const upsert = this.store.db.query(
      `INSERT INTO calendars (account_id, id, href, display_name, server_color, category, server_writable, sort)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT (account_id, id) DO UPDATE SET href = excluded.href,
         display_name = excluded.display_name, server_color = excluded.server_color,
         server_writable = excluded.server_writable, sort = excluded.sort`,
    );
    found.forEach((calendar, sort) => {
      upsert.run(
        accountId,
        calendarId(calendar.href),
        calendar.href,
        calendar.displayName,
        calendar.color ?? null,
        guessCategory(calendar.displayName),
        Number(calendar.writable),
        sort,
      );
    });
  }

  private sealFeed(id: string, url: string): Uint8Array {
    return this.store.box.seal(`calendar_accounts/${id}/feed_url_sealed`, url);
  }

  private seal(id: string, password: string): Uint8Array {
    return this.store.box.seal(aad(id), password);
  }
}

function aad(id: string): string {
  return `calendar_accounts/${id}/password_sealed`;
}

/** The last path segment of the collection URL, as a lower-case slug. */
export function calendarId(href: string): string {
  const segment = new URL(href).pathname.split("/").filter(Boolean).at(-1) ?? "calendar";
  return (
    decodeURIComponent(segment)
      .toLowerCase()
      .replace(/[^a-z0-9-]+/g, "-") || "calendar"
  );
}

/** A first guess from the calendar's name; Settings lets you change it. */
export function guessCategory(name: string): Category {
  if (/\bwork|office|team\b/i.test(name)) {
    return "work";
  }
  if (/\b(fitness|gym|run|training|sport)/i.test(name)) {
    return "fitness";
  }
  return "personal";
}

function toAccount(row: AccountRow): Account {
  return {
    id: row.id,
    kind: row.kind,
    provider: row.provider,
    displayName: row.display_name,
    serverUrl: row.server_url ?? "",
    homeUrl: row.home_url ?? undefined,
    username: row.username ?? "",
    passwordSet: row.password_sealed !== null,
    feedHost: row.feed_host ?? undefined,
    lastUsedTime: row.last_used_time ?? undefined,
    lastSyncTime: row.last_sync_time ?? undefined,
    status: row.status,
    statusDetail: row.status_detail ?? undefined,
    createTime: row.create_time,
    updateTime: row.update_time,
  };
}

function toCalendar(row: CalendarRow): StoredCalendar {
  return {
    accountId: row.account_id,
    id: row.id,
    href: row.href,
    displayName: row.display_name,
    serverColor: row.server_color ?? undefined,
    category: row.category,
    serverWritable: row.server_writable === 1,
    forceReadOnly: row.force_read_only === 1,
    enabled: row.enabled === 1,
    sort: row.sort,
  };
}
