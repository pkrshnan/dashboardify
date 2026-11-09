// The home screen's calendar, read from calendar-cache.db with the calendars' settings from
// settings.db: category, shown or hidden, and whether new events can go on them.

import type { CalendarEvent, CalendarSource, CaptureHints } from "../home/calendar";
import type { Category } from "../home/types";
import { mapsUrl } from "../places/place";
import type { CalendarAccounts } from "./accounts";
import type { CachedEvent, CalendarInfo, EventCache } from "./cache";

const DAY_MS = 86_400_000;
/** The capture box's history: titles from this far back… */
const HISTORY_MS = 180 * DAY_MS;
/** …at most this many, so the home response stays small. */
export const MAX_TITLE_HINTS = 300;

interface Calendar {
  name: string;
  displayName: string;
  category: Category;
  writable: boolean;
  enabled: boolean;
  sort: number;
}

export function cacheSource(cache: EventCache, accounts: CalendarAccounts): CalendarSource {
  /** "<account>/<calendar>" → what the reader needs, in Settings order across accounts. */
  const calendars = (): Map<string, Calendar> => {
    const all = new Map<string, Calendar>();
    for (const account of accounts.list()) {
      for (const c of accounts.calendars(account.id)) {
        all.set(`${account.id}/${c.id}`, {
          name: `calendarAccounts/${account.id}/calendars/${c.id}`,
          displayName: c.displayName,
          category: c.category,
          writable: c.serverWritable && !c.forceReadOnly,
          enabled: c.enabled,
          sort: all.size,
        });
      }
    }
    return all;
  };

  return {
    events: (from, to) => {
      const known = calendars();
      const events = cache.between(new Date(from), new Date(to), known as CalendarInfo);
      return Promise.resolve(events.map((event) => toCalendarEvent(event, known)));
    },

    status: () => {
      const list = accounts.list();
      if (list.length === 0) {
        return undefined;
      }
      const times = [...calendars()]
        .filter(([, c]) => c.enabled)
        .map(([key]) => {
          const [accountId = "", calendarId = ""] = key.split("/");
          return cache.state(accountId, calendarId).lastSyncTime;
        });
      const synced = times.every(Boolean) ? (times as string[]).sort()[0] : undefined;
      return { lastSyncTime: synced, hasErrors: list.some((a) => a.status !== "ok") };
    },

    hints: (now) => hintsFor(cache, accounts, calendars(), now),
  };
}

function hintsFor(
  cache: EventCache,
  accounts: CalendarAccounts,
  known: Map<string, Calendar>,
  now: number,
): CaptureHints | undefined {
  const writable = [...known].filter(([, c]) => c.writable && c.enabled);
  if (writable.length === 0) {
    return undefined;
  }
  const name = (key: string) => known.get(key)?.name ?? "";
  const preferences = accounts.preferences();
  const titles = cache
    .titleCounts(new Date(now - HISTORY_MS), new Date(now), MAX_TITLE_HINTS)
    .filter((t) => known.get(`${t.accountId}/${t.calendarId}`)?.writable)
    .map((t) => ({
      titleKey: t.titleKey,
      calendar: name(`${t.accountId}/${t.calendarId}`),
      count: t.count,
      lastTime: new Date(t.lastMs).toISOString(),
    }));
  return {
    calendars: writable.map(([, c]) => ({
      name: c.name,
      displayName: c.displayName,
      category: c.category,
    })),
    defaultCalendar: preferences.defaultCalendar ? name(preferences.defaultCalendar) : undefined,
    rules: preferences.keywordRules.map((rule) => ({
      words: rule.words,
      calendar: name(rule.calendar),
    })),
    titles,
  };
}

function toCalendarEvent(event: CachedEvent, known: Map<string, Calendar>): CalendarEvent {
  const calendar = known.get(`${event.accountId}/${event.calendarId}`);
  return {
    title: event.title || "(No title)",
    start: event.start.getTime(),
    end: event.end.getTime(),
    detail: event.location.split("\n")[0] || undefined,
    // Only a located place gets a Maps link: a search for "Room 4B" helps no one.
    mapsUrl: event.geo
      ? mapsUrl(event.location.split("\n")[0] || event.title, event.geo)
      : undefined,
    category: calendar?.category ?? "personal",
    url: event.url.startsWith("https:") ? event.url : undefined,
    event: `events/${event.eventId}`,
    calendar: calendar?.name,
    writable: calendar?.writable ?? false,
    allDay: event.allDay,
    startDate: event.startDate,
    endDate: event.endDate,
  };
}
