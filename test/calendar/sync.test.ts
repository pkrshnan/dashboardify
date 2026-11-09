import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarAccounts } from "../../src/calendar/accounts";
import { type CalendarInfo, EventCache } from "../../src/calendar/cache";
import { CalDavClient } from "../../src/calendar/caldav";
import { CalendarSync } from "../../src/calendar/sync";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";
import { FakeCalDav } from "./fake-caldav";

const ics = (uid: string, title: string, start = "20261112T100000Z", end = "20261112T110000Z") =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T000000Z\r\n` +
  `DTSTART:${start}\r\nDTEND:${end}\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

let dir: string;
let store: SettingsStore;
let accounts: CalendarAccounts;
let cache: EventCache;
let server: FakeCalDav;
let sync: CalendarSync;
let now: Date;
let down: boolean;
let log: string[];
const key = randomBytes(32);

function makeSync(): CalendarSync {
  return new CalendarSync({
    accounts,
    cache,
    timeZone: "Europe/London",
    now: () => now,
    log: (line) => log.push(line),
    connect: (account) =>
      new CalDavClient({ ...account, allowedDomains: ["icloud.com"] }, (request) => {
        if (down) {
          return Promise.reject(new TypeError("fetch failed"));
        }
        return server.fetch(request);
      }),
  });
}

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "sync-"));
  now = new Date("2026-11-10T08:00:00Z");
  down = false;
  log = [];
  server = new FakeCalDav([
    { id: "home", displayName: "Personal" },
    { id: "dinners", displayName: "Dinners with Alex", writable: false },
  ]);
  store = await SettingsStore.open(dir, new SecretBox(key));
  accounts = new CalendarAccounts(store, () => now);
  const client = new CalDavClient(
    {
      serverUrl: server.serverUrl,
      username: server.username,
      password: server.password,
      allowedDomains: ["icloud.com"],
    },
    server.fetch,
  );
  const found = await client.listCalendars(server.homeUrl);
  accounts.create(
    {
      id: "icloud",
      provider: "icloud",
      displayName: "iCloud",
      serverUrl: server.serverUrl,
      homeUrl: server.homeUrl,
      username: server.username,
      password: server.password,
    },
    found.map((f) => ({
      href: f.url,
      displayName: f.displayName,
      color: f.color,
      writable: f.writable,
    })),
  );
  cache = await EventCache.open(dir);
  sync = makeSync();
  server.requests.length = 0;
});

afterEach(async () => {
  cache.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function info(): CalendarInfo {
  return new Map(
    accounts
      .calendars("icloud")
      .map((c) => [
        `icloud/${c.id}`,
        { writable: c.serverWritable && !c.forceReadOnly, enabled: c.enabled, sort: c.sort },
      ]),
  );
}

function titles(): string[] {
  const from = new Date("2026-11-01T00:00:00Z");
  const to = new Date("2026-12-01T00:00:00Z");
  return cache.between(from, to, info()).map((e) => e.title);
}

describe("CalendarSync", () => {
  test("the first sync fetches every event", async () => {
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    server.putEvent("dinners", "b.ics", ics("b", "Dinner", "20261113T190000Z", "20261113T210000Z"));

    await sync.tick();

    expect(titles()).toEqual(["Physio", "Dinner"]);
  });

  test("a quiet poll is one request", async () => {
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    await sync.tick();
    server.requests.length = 0;

    await sync.tick();

    expect(server.requests).toEqual(["PROPFIND p42-caldav.icloud.com/1234567/calendars/"]);
  });

  test("an event added, changed or deleted in Apple Calendar shows after one tick", async () => {
    await sync.tick();
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    await sync.tick();
    const added = titles();
    server.putEvent("home", "a.ics", ics("a", "Physio, moved"));
    await sync.tick();
    const changed = titles();
    server.removeEvent("home", "a.ics");
    await sync.tick();

    expect(added).toEqual(["Physio"]);
    expect(changed).toEqual(["Physio, moved"]);
    expect(titles()).toEqual([]);
  });

  test("an expired sync token falls back to comparing etags", async () => {
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    server.putEvent("home", "b.ics", ics("b", "Lunch", "20261112T123000Z", "20261112T133000Z"));
    await sync.tick();
    server.expireTokens();
    server.removeEvent("home", "b.ics");
    server.putEvent("home", "c.ics", ics("c", "Gym", "20261112T180000Z", "20261112T190000Z"));

    await sync.tick();

    expect(titles()).toEqual(["Physio", "Gym"]);
    expect(log.some((line) => line.includes("sync token expired"))).toBe(true);
  });

  test("a refused password marks the account and stops polling", async () => {
    server.password = "revoked-on-the-phone";

    await sync.tick();
    server.requests.length = 0;
    await sync.tick();

    expect(accounts.get("icloud")?.status).toBe("auth_failed");
    expect(server.requests).toEqual([]);
  });

  test("a password replaced from another connection (the CLI) resumes on the next tick", async () => {
    server.password = "new-pass-word-0000";
    await sync.tick();
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    const cli = await SettingsStore.open(dir, new SecretBox(key));

    new CalendarAccounts(cli).update("icloud", { password: "new-pass-word-0000" });
    await sync.tick();

    expect(accounts.get("icloud")?.status).toBe("ok");
    expect(titles()).toEqual(["Physio"]);
    cli.close();
  });

  test("a server that can't be reached backs off, then retries", async () => {
    down = true;
    await sync.tick();
    down = false;
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    now = new Date(now.getTime() + 60_000);
    await sync.tick();
    const tooSoon = titles();
    now = new Date(now.getTime() + 5 * 60_000);
    await sync.tick();

    expect(tooSoon).toEqual([]);
    expect(titles()).toEqual(["Physio"]);
    expect(accounts.get("icloud")?.status).toBe("ok");
  });

  test("the same event on two calendars shows once, from the writable one", async () => {
    server.putEvent("dinners", "shared.ics", ics("same-uid", "Dinner with Alex"));
    server.putEvent("home", "copy.ics", ics("same-uid", "Dinner with Alex"));

    await sync.tick();
    const [event] = cache.between(new Date("2026-11-01"), new Date("2026-12-01"), info());

    expect(titles()).toEqual(["Dinner with Alex"]);
    expect(event?.calendarId).toBe("home");
  });

  test("a hidden calendar's events aren't shown", async () => {
    server.putEvent("dinners", "b.ics", ics("b", "Dinner"));
    accounts.updateCalendar("icloud", "dinners", { enabled: false });

    await sync.tick();

    expect(titles()).toEqual([]);
  });

  test("an event that can't be read is skipped, not retried", async () => {
    server.putEvent("home", "bad.ics", "not a calendar");
    server.putEvent("home", "a.ics", ics("a", "Physio"));

    await sync.tick();

    expect(titles()).toEqual(["Physio"]);
    expect(cache.etags("icloud", "home").size).toBe(2);
  });

  test("deleting the cache file fetches everything again", async () => {
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    await sync.tick();
    cache.close();
    await rm(join(dir, "calendar-cache.db"));
    await rm(join(dir, "calendar-cache.db-wal"), { force: true });
    await rm(join(dir, "calendar-cache.db-shm"), { force: true });
    cache = await EventCache.open(dir);
    sync = makeSync();

    await sync.tick();

    expect(titles()).toEqual(["Physio"]);
  });

  test("a removed account's events are dropped", async () => {
    server.putEvent("home", "a.ics", ics("a", "Physio"));
    await sync.tick();

    accounts.delete("icloud");
    await sync.tick();

    expect(cache.resources()).toEqual([]);
  });
});
