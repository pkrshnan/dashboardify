import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { type CalendarInfo, EventCache, eventId } from "../../src/calendar/cache";
import type { Occurrence } from "../../src/calendar/ical";

let dir: string;
let cache: EventCache;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "cache-"));
  cache = await EventCache.open(dir);
});

afterEach(async () => {
  cache.close();
  await rm(dir, { recursive: true, force: true });
});

function occurrence(uid: string, title: string): Occurrence {
  return {
    uid,
    title,
    location: "",
    notes: "",
    url: "",
    start: new Date("2026-11-12T10:00:00Z"),
    end: new Date("2026-11-12T11:00:00Z"),
    allDay: false,
    recurring: false,
  };
}

function put(calendarId: string, uid: string, title: string) {
  cache.put(
    {
      accountId: "icloud",
      calendarId,
      href: `https://x/${calendarId}/${uid}.ics`,
      etag: '"1"',
      ics: "",
    },
    [occurrence(uid, title)],
  );
}

describe("eventId", () => {
  test("is 16 base32 characters, stable, and differs per instance", () => {
    const id = eventId("icloud", "home", "abc@dashboardify", undefined);

    expect(id).toMatch(/^[a-z2-7]{16}$/);
    expect(eventId("icloud", "home", "abc@dashboardify", undefined)).toBe(id);
    expect(eventId("icloud", "home", "abc@dashboardify", "2026-11-12T10:00:00.000Z")).not.toBe(id);
  });
});

describe("EventCache", () => {
  test("the file is readable only by the owner", async () => {
    expect((await stat(join(dir, "calendar-cache.db"))).mode & 0o777).toBe(0o600);
  });

  test("with no writable copy, the first calendar in Settings order wins", () => {
    put("b", "same", "From B");
    put("a", "same", "From A");
    const calendars: CalendarInfo = new Map([
      ["icloud/a", { writable: false, enabled: true, sort: 1 }],
      ["icloud/b", { writable: false, enabled: true, sort: 0 }],
    ]);

    const events = cache.between(new Date("2026-11-01"), new Date("2026-12-01"), calendars);

    expect(events.map((e) => e.title)).toEqual(["From B"]);
  });

  test("events on calendars not in Settings aren't shown", () => {
    put("gone", "x", "Old");

    expect(cache.between(new Date("2026-11-01"), new Date("2026-12-01"), new Map())).toEqual([]);
  });
});
