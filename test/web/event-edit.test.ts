import { beforeEach, describe, expect, test } from "bun:test";
import { deleteEvent, type EventDetail, getEvent, updateEvent } from "../../web/api";
import {
  changeFrom,
  formFor,
  moveStart,
  readOnlyReason,
  whenLabel,
} from "../../web/lib/event-edit";
import { FakeCalDav } from "../calendar/fake-caldav";
import { useApi } from "../server/api/helpers";

const ZONE = "Europe/London";

const lunch: EventDetail = {
  name: "events/lunch",
  title: "Lunch with Sam",
  startTime: "2026-11-12T12:30:00Z",
  endTime: "2026-11-12T13:30:00Z",
  allDay: false,
  location: "",
  notes: "",
  writable: true,
  recurring: false,
  etag: '"1"',
};

describe("event panel form", () => {
  test("shows times as wall clocks in the server's zone", () => {
    const summer = { ...lunch, startTime: "2026-07-01T11:30:00Z", endTime: "2026-07-01T12:30:00Z" };

    expect(formFor(summer, ZONE)).toMatchObject({
      start: "2026-07-01T12:30",
      end: "2026-07-01T13:30",
    });
  });

  test("an unchanged form changes nothing", () => {
    expect(changeFrom(lunch, formFor(lunch, ZONE), ZONE)).toEqual({ change: {} });
  });

  test("sends only the fields that changed, trimmed", () => {
    const form = { ...formFor(lunch, ZONE), title: " Lunch at one ", location: "Dishoom" };

    expect(changeFrom(lunch, form, ZONE)).toEqual({
      change: { title: "Lunch at one", location: "Dishoom" },
    });
  });

  test("moving the start keeps the length", () => {
    const form = moveStart(formFor(lunch, ZONE), "2026-11-12T13:00", ZONE);

    expect(form.end).toBe("2026-11-12T14:00");
    expect(changeFrom(lunch, form, ZONE)).toEqual({
      change: { startTime: "2026-11-12T13:00:00.000Z", endTime: "2026-11-12T14:00:00.000Z" },
    });
  });

  test("refuses an empty title or an end before the start", () => {
    const form = formFor(lunch, ZONE);

    expect(changeFrom(lunch, { ...form, title: "  " }, ZONE)).toEqual({
      error: "Give it a title.",
    });
    expect(changeFrom(lunch, { ...form, end: form.start }, ZONE)).toEqual({
      error: "It has to end after it starts.",
    });
  });

  test("never sends times for an all-day event", () => {
    const allDay = { ...lunch, allDay: true, startTime: "2026-11-12T00:00:00Z" };
    const form = { ...formFor(allDay, ZONE), end: "" };

    expect(changeFrom(allDay, form, ZONE)).toEqual({ change: {} });
  });

  test("labels the time, a span over midnight, and all-day days", () => {
    const late = { ...lunch, startTime: "2026-11-12T23:00:00Z", endTime: "2026-11-13T01:00:00Z" };
    const trip = {
      ...lunch,
      allDay: true,
      startTime: "2026-11-12T00:00:00Z",
      endTime: "2026-11-15T00:00:00Z",
    };

    expect(whenLabel(lunch, ZONE)).toBe("Thu 12 Nov · 12:30–13:30");
    expect(whenLabel(late, ZONE)).toBe("Thu 12 Nov, 23:00 – Fri 13 Nov, 01:00");
    expect(whenLabel(trip, ZONE)).toBe("12–14 Nov · All day");
  });

  test("repeating events and read-only calendars say why they can't be changed", () => {
    expect(readOnlyReason(lunch)).toBeNull();
    expect(readOnlyReason({ ...lunch, recurring: true })).toContain("Apple Calendar");
    expect(readOnlyReason({ ...lunch, writable: false })).toContain("read-only");
  });
});

describe("event panel API adapter", () => {
  let server: FakeCalDav;
  const api = useApi({ calDav: () => server });

  function through<T>(run: () => Promise<T>): Promise<T> {
    const original = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      api.app.request(url, init)) as typeof fetch;
    return run().finally(() => {
      globalThis.fetch = original;
    });
  }

  beforeEach(async () => {
    server = new FakeCalDav([{ id: "home", displayName: "Personal" }]);
    await api.call("/v1/calendarAccounts", "POST", {
      kind: "KIND_CALDAV",
      provider: "icloud",
      username: server.username,
      password: server.password,
    });
    await api.sync.tick();
  });

  async function made(): Promise<EventDetail> {
    const { body } = await api.call("/v1/events?requestId=r1", "POST", {
      calendar: "calendarAccounts/icloud/calendars/home",
      title: lunch.title,
      startTime: lunch.startTime,
      endTime: lunch.endTime,
    });
    return through(() => getEvent("secret", body.name));
  }

  test("gets, edits and deletes an event in iCloud", async () => {
    const event = await made();

    const updated = await through(() =>
      updateEvent("secret", event, { title: "Lunch at one", startTime: "2026-11-12T13:00:00Z" }),
    );
    await through(() => deleteEvent("secret", updated.name, updated.etag));

    expect(event).toMatchObject({ title: "Lunch with Sam", writable: true, recurring: false });
    expect(updated).toMatchObject({ title: "Lunch at one", endTime: "2026-11-12T13:30:00Z" });
    expect(updated.startTime).toBe("2026-11-12T13:00:00Z");
    expect(server.event("home", "r1.ics")).toBeUndefined();
  });

  test("a save after a change in Apple Calendar is refused, not overwritten", async () => {
    const event = await made();
    const changed = server.event("home", "r1.ics")?.ics.replace("Lunch with Sam", "Moved") ?? "";
    server.putEvent("home", "r1.ics", changed);

    const error = await through(() =>
      updateEvent("secret", event, { title: "Lunch at one" }).catch((e: Error) => e),
    );

    expect((error as Error).message).toContain("changed in Apple Calendar");
    expect(server.event("home", "r1.ics")?.ics).toContain("SUMMARY:Moved");
  });
});
