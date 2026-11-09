import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarAccounts } from "../../src/calendar/accounts";
import { EventCache } from "../../src/calendar/cache";
import type { Occurrence } from "../../src/calendar/ical";
import { cacheSource, MAX_TITLE_HINTS } from "../../src/calendar/source";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";

let dir: string;
let store: SettingsStore;
let accounts: CalendarAccounts;
let cache: EventCache;
const now = new Date("2026-11-10T08:00:00Z").getTime();

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "source-"));
  store = await SettingsStore.open(dir, new SecretBox(randomBytes(32)));
  accounts = new CalendarAccounts(store);
  accounts.create(
    {
      id: "icloud",
      provider: "icloud",
      displayName: "iCloud",
      serverUrl: "https://caldav.icloud.com/",
      homeUrl: "https://p42-caldav.icloud.com/1/calendars/",
      username: "you@icloud.com",
      password: "pw",
    },
    [
      {
        href: "https://p42-caldav.icloud.com/1/calendars/home/",
        displayName: "Personal",
        writable: true,
      },
      {
        href: "https://p42-caldav.icloud.com/1/calendars/work/",
        displayName: "Work",
        writable: true,
      },
      {
        href: "https://p42-caldav.icloud.com/1/calendars/dinners/",
        displayName: "Dinners",
        writable: false,
      },
    ],
  );
  accounts.setPreferences({
    defaultCalendar: "icloud/home",
    keywordRules: [{ words: ["gym"], calendar: "icloud/work" }],
  });
  cache = await EventCache.open(dir);
});

afterEach(async () => {
  cache.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function occurrence(over: Partial<Occurrence>): Occurrence {
  return {
    uid: "u",
    title: "Event",
    location: "",
    notes: "",
    url: "",
    start: new Date("2026-11-10T10:00:00Z"),
    end: new Date("2026-11-10T11:00:00Z"),
    allDay: false,
    recurring: false,
    ...over,
  };
}

function put(calendarId: string, name: string, occurrences: Occurrence[]) {
  cache.put(
    {
      accountId: "icloud",
      calendarId,
      href: `https://x/${calendarId}/${name}.ics`,
      etag: '"1"',
      ics: "",
    },
    occurrences,
  );
}

/** 0 → "a", 25 → "z", 26 → "ba": distinct titles that titleKey (letters only) keeps distinct. */
function letters(n: number): string {
  let out = "";
  let i = n;
  do {
    out = String.fromCharCode(97 + (i % 26)) + out;
    i = Math.floor(i / 26);
  } while (i > 0);
  return out;
}

describe("cacheSource.events", () => {
  test("carries the calendar's category, name and write access", async () => {
    put("work", "a", [occurrence({ uid: "a", title: "Standup", location: "Room 4\n2nd floor" })]);
    put("dinners", "b", [occurrence({ uid: "b", title: "Dinner" })]);

    const events = await cacheSource(cache, accounts).events(now, now + 86_400_000);

    expect(
      events.map(({ title, category, calendar, writable, detail }) => ({
        title,
        category,
        calendar,
        writable,
        detail,
      })),
    ).toEqual([
      {
        title: "Standup",
        category: "work",
        calendar: "calendarAccounts/icloud/calendars/work",
        writable: true,
        detail: "Room 4",
      },
      {
        title: "Dinner",
        category: "personal",
        calendar: "calendarAccounts/icloud/calendars/dinners",
        writable: false,
        detail: undefined,
      },
    ]);
    expect(events[0]?.event).toMatch(/^events\/[a-z2-7]{16}$/);
  });

  test("only https links become Join buttons", async () => {
    put("home", "a", [occurrence({ uid: "a", title: "call", url: "https://meet.example.com/x" })]);
    put("home", "b", [occurrence({ uid: "b", title: "prank", url: "javascript:alert(1)" })]);

    const events = await cacheSource(cache, accounts).events(now, now + 86_400_000);
    const links = Object.fromEntries(events.map((e) => [e.title, e.url]));

    expect(links).toEqual({ call: "https://meet.example.com/x", prank: undefined });
  });
});

describe("cacheSource.status", () => {
  test("is the oldest sync across shown calendars, and flags accounts in trouble", () => {
    cache.setState("icloud", "home", { lastSyncTime: "2026-11-10T07:58:00Z" });
    cache.setState("icloud", "work", { lastSyncTime: "2026-11-10T07:50:00Z" });
    cache.setState("icloud", "dinners", { lastSyncTime: "2026-11-10T07:59:00Z" });

    const ok = cacheSource(cache, accounts).status?.();
    accounts.setStatus("icloud", "auth_failed");
    const failed = cacheSource(cache, accounts).status?.();

    expect(ok).toEqual({ lastSyncTime: "2026-11-10T07:50:00Z", hasErrors: false });
    expect(failed?.hasErrors).toBe(true);
  });

  test("has no sync time until every shown calendar has synced once", () => {
    cache.setState("icloud", "home", { lastSyncTime: "2026-11-10T07:58:00Z" });

    expect(cacheSource(cache, accounts).status?.()?.lastSyncTime).toBeUndefined();
  });

  test("is undefined with no account", () => {
    accounts.delete("icloud");

    expect(cacheSource(cache, accounts).status?.()).toBeUndefined();
  });
});

describe("cacheSource.hints", () => {
  test("lists writable calendars, the default, the rules and past titles on writable calendars", () => {
    const past = (i: number) => new Date(now - i * 86_400_000);
    put(
      "work",
      "a",
      [1, 2, 3].map((i) =>
        occurrence({ uid: `a${i}`, title: "Standup", start: past(i), end: past(i) }),
      ),
    );
    put("dinners", "b", [occurrence({ uid: "b", title: "Dinner", start: past(1), end: past(1) })]);

    const hints = cacheSource(cache, accounts).hints?.(now);

    expect(hints?.calendars.map((c) => c.displayName)).toEqual(["Personal", "Work"]);
    expect(hints?.defaultCalendar).toBe("calendarAccounts/icloud/calendars/home");
    expect(hints?.rules).toEqual([
      { words: ["gym"], calendar: "calendarAccounts/icloud/calendars/work" },
    ]);
    expect(hints?.titles).toEqual([
      {
        titleKey: "standup",
        calendar: "calendarAccounts/icloud/calendars/work",
        count: 3,
        lastTime: past(1).toISOString(),
      },
    ]);
  });

  test("keeps at most 300 titles", () => {
    const at = new Date(now - 86_400_000);
    put(
      "home",
      "many",
      Array.from({ length: MAX_TITLE_HINTS + 50 }, (_, i) =>
        occurrence({ uid: `t${i}`, title: `Thing ${letters(i)}`, start: at, end: at }),
      ),
    );

    expect(cacheSource(cache, accounts).hints?.(now)?.titles.length).toBe(MAX_TITLE_HINTS);
  });
});
