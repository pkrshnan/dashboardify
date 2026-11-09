import { describe, expect, test } from "bun:test";
import {
  type CalendarView,
  connectICloud,
  listCalendarAccounts,
  listCalendars,
  updateCalendar,
  updateCalendarPreferences,
} from "../../web/api";
import {
  calendarNote,
  changesAfterConnect,
  parseWords,
  statusLine,
  writableChoices,
} from "../../web/settings/calendar-helpers";
import { FakeCalDav } from "../calendar/fake-caldav";
import { useApi } from "../server/api/helpers";

let server: FakeCalDav;

function through<T>(api: ReturnType<typeof useApi>, run: () => Promise<T>): Promise<T> {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) =>
    api.app.request(url, init)) as typeof fetch;
  return run().finally(() => {
    globalThis.fetch = original;
  });
}

const calendar = (over: Partial<CalendarView>): CalendarView => ({
  name: "",
  displayName: "Personal",
  category: "personal",
  enabled: true,
  forceReadOnly: false,
  writable: true,
  ...over,
});

describe("calendar API adapter", () => {
  const api = useApi({ calDav: () => server });

  test("tests, connects and changes a calendar", async () => {
    server = new FakeCalDav([
      { id: "home", displayName: "Personal" },
      { id: "work", displayName: "Work" },
      { id: "dinners", displayName: "Dinners", writable: false },
    ]);
    const login = { username: server.username, password: server.password };

    const preview = await through(api, () => connectICloud("secret", login, true));
    const before = await through(api, () => listCalendarAccounts("secret"));
    const { calendars } = await through(api, () => connectICloud("secret", login, false));
    const work = calendars[1]?.name ?? "";
    await through(api, () => updateCalendar("secret", work, { category: "focus", enabled: false }));
    const prefs = await through(api, () =>
      updateCalendarPreferences("secret", { keywordRules: [{ words: ["gym"], calendar: work }] }),
    );
    const after = await through(api, () => listCalendars("secret", "calendarAccounts/icloud"));

    expect(preview.calendars.map((c) => [c.displayName, c.writable])).toEqual([
      ["Personal", true],
      ["Work", true],
      ["Dinners", false],
    ]);
    expect(before).toEqual([]);
    expect(after[1]).toMatchObject({ category: "focus", enabled: false });
    expect(prefs.keywordRules).toEqual([{ words: ["gym"], calendar: work }]);
  });

  test("a refused password comes back as the server's sentence", async () => {
    server = new FakeCalDav([{ id: "home", displayName: "Personal" }]);

    const error = await through(api, () =>
      connectICloud("secret", { username: server.username, password: "nope" }, true).catch(
        (e: Error) => e,
      ),
    );

    expect((error as Error).message).toContain("app-specific password");
  });
});

describe("calendar helpers", () => {
  test("status lines", () => {
    const account = { name: "a", displayName: "iCloud", username: "u" };

    expect(statusLine({ ...account, status: "STATUS_AUTH_FAILED" })).toMatchObject({ warn: true });
    expect(statusLine({ ...account, status: "STATUS_OK" }).text).toBe("Not synced yet");
    expect(
      statusLine({ ...account, status: "STATUS_OK", lastSyncTime: "2026-11-08T09:10:00" }).text,
    ).toMatch(/^Synced \d\d:\d\d$/);
  });

  test("read-only notes and writable choices", () => {
    const shared = calendar({ displayName: "Dinners", writable: false });
    const locked = calendar({ displayName: "Work", writable: false, forceReadOnly: true });
    const hidden = calendar({ displayName: "Gym", enabled: false });

    expect([calendarNote(shared), calendarNote(locked), calendarNote(calendar({}))]).toEqual([
      "Read-only",
      "Kept read-only here",
      "",
    ]);
    expect(
      writableChoices([calendar({}), shared, locked, hidden]).map((c) => c.displayName),
    ).toEqual(["Personal"]);
  });

  test("rule words", () => {
    expect(parseWords(" gym, run ,, swim ")).toEqual(["gym", "run", "swim"]);
  });

  test("after connecting, only the calendars changed on the found screen are updated", () => {
    const chosen = [
      calendar({}),
      calendar({ displayName: "Work", category: "focus" }),
      calendar({ displayName: "UK Holidays", enabled: false }),
    ];
    const saved = [
      calendar({ name: "a/home" }),
      calendar({ name: "a/work", displayName: "Work", category: "work" }),
      calendar({ name: "a/hol", displayName: "UK Holidays" }),
    ];

    expect(changesAfterConnect(chosen, saved)).toEqual([
      { name: "a/work", change: { category: "focus" } },
      { name: "a/hol", change: { enabled: false } },
    ]);
  });
});
