// The core settings: one row of values that used to live in .env (time zone, tasks inbox,
// tailnet sign-in), and where place searches look first. GeneralSettings reads it through a cache that reloads when the database
// changes, so a write from the CLI or the API is seen on the next request.

import type { Place } from "../places/place";
import { SettingsStore } from "./store";

SettingsStore.register("core", [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        time_zone TEXT,
        tasks_inbox TEXT NOT NULL DEFAULT 'Inbox.md',
        tailnet_proxy TEXT,
        tailnet_logins TEXT NOT NULL DEFAULT '[]',
        update_time TEXT NOT NULL
      )`);
      db.query("INSERT INTO settings (id, update_time) VALUES (1, ?)").run(
        new Date().toISOString(),
      );
    },
  },
  {
    version: 2,
    up: (db) => {
      db.run("ALTER TABLE settings ADD COLUMN places_near TEXT");
    },
  },
]);

export interface StoredSettings {
  /** IANA zone; unset means the server's own zone. */
  timeZone?: string;
  tasksInbox: string;
  /** An IP address, or "gateway" for the Docker bridge. */
  tailnetProxy?: string;
  tailnetLogins: string[];
  /** Place searches look near here first. */
  placesNear?: Place;
  updateTime: string;
}

export type SettingsChange = Partial<Omit<StoredSettings, "updateTime">>;

interface Row {
  time_zone: string | null;
  tasks_inbox: string;
  tailnet_proxy: string | null;
  tailnet_logins: string;
  places_near: string | null;
  update_time: string;
}

export class GeneralSettings {
  private cached?: StoredSettings;
  private loadedVersion = -1;

  constructor(
    private readonly store: SettingsStore,
    private readonly now: () => Date = () => new Date(),
  ) {}

  get(): StoredSettings {
    const version = this.store.version();
    if (!this.cached || version !== this.loadedVersion) {
      const row = this.store.db
        .query<Row, []>(
          "SELECT time_zone, tasks_inbox, tailnet_proxy, tailnet_logins, places_near, update_time FROM settings WHERE id = 1",
        )
        .get();
      if (!row) {
        throw new Error("settings.db has no settings row");
      }
      this.cached = {
        timeZone: row.time_zone ?? undefined,
        tasksInbox: row.tasks_inbox,
        tailnetProxy: row.tailnet_proxy ?? undefined,
        tailnetLogins: JSON.parse(row.tailnet_logins) as string[],
        placesNear: row.places_near ? (JSON.parse(row.places_near) as Place) : undefined,
        updateTime: row.update_time,
      };
      this.loadedVersion = version;
    }
    return this.cached;
  }

  /** Writes the given fields; `undefined` for an optional field clears it. */
  update(change: SettingsChange): StoredSettings {
    if (change.timeZone !== undefined) {
      checkTimeZone(change.timeZone, "Settings");
    }
    const next = { ...this.get(), ...change, updateTime: this.now().toISOString() };
    this.store.db
      .query(
        "UPDATE settings SET time_zone = ?, tasks_inbox = ?, tailnet_proxy = ?, tailnet_logins = ?, places_near = ?, update_time = ? WHERE id = 1",
      )
      .run(
        next.timeZone ?? null,
        next.tasksInbox,
        next.tailnetProxy ?? null,
        JSON.stringify(next.tailnetLogins),
        next.placesNear ? JSON.stringify(next.placesNear) : null,
        next.updateTime,
      );
    this.cached = undefined;
    return this.get();
  }
}

/** Throws with where the bad value came from, e.g. "TZ_NAME in .env". */
export function checkTimeZone(timeZone: string, source: string): void {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
  } catch {
    throw new Error(
      `${source}: "${timeZone}" is not a time zone. Use an IANA name like Europe/London.`,
    );
  }
}
