import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import {
  editEvent,
  NotEditable,
  type ReadOptions,
  readOccurrences,
  writeEvent,
} from "../../src/calendar/ical";

// Hand-written in the shapes iCloud and Outlook produce; not captured from a real account.
async function fixture(name: string): Promise<string> {
  return Bun.file(join(import.meta.dir, "fixtures", name)).text();
}

const window: ReadOptions = {
  from: new Date("2026-10-01T00:00:00Z"),
  to: new Date("2026-12-01T00:00:00Z"),
  floatingZone: "Europe/London",
};

/** Occurrences as plain ISO values, for compact expectations. */
async function read(name: string, options: Partial<ReadOptions> = {}) {
  return readOccurrences(await fixture(name), { ...window, ...options }).map((o) => ({
    ...o,
    start: o.start.toISOString(),
    end: o.end.toISOString(),
  }));
}

describe("readOccurrences", () => {
  test("a timed iCloud event in its own zone", async () => {
    expect(await read("icloud-timed.ics")).toEqual([
      {
        uid: "5B2D7C1E-8F4A-4E6B-9C3D-2A1F0E9D8C7B",
        title: "Physio",
        location: "Northside Clinic\n12 High St",
        notes: "Bring the referral letter",
        url: "https://example.com/booking/123",
        start: "2026-11-12T18:00:00.000Z",
        end: "2026-11-12T19:00:00.000Z",
        allDay: false,
        startDate: undefined,
        endDate: undefined,
        timeZone: "America/Los_Angeles",
        recurring: false,
      },
    ]);
  });

  test("an all-day event keeps its dates and starts at midnight in the server's zone", async () => {
    const [lisbon] = await read("icloud-all-day.ics");

    expect(lisbon).toMatchObject({
      title: "Lisbon",
      allDay: true,
      startDate: "2026-11-13",
      endDate: "2026-11-16",
      start: "2026-11-13T00:00:00.000Z",
      end: "2026-11-16T00:00:00.000Z",
      timeZone: undefined,
    });
  });

  test("a weekly event expands across a DST change, with an EXDATE and a moved instance", async () => {
    const standups = (
      await read("icloud-recurring.ics", { to: new Date("2026-11-17T00:00:00Z") })
    ).map(({ title, start, end, recurrenceId, recurring }) => ({
      title,
      start,
      end,
      recurrenceId,
      recurring,
    }));

    expect(standups).toEqual([
      {
        title: "Standup",
        start: "2026-10-12T08:00:00.000Z",
        end: "2026-10-12T08:15:00.000Z",
        recurrenceId: "2026-10-12T08:00:00.000Z",
        recurring: true,
      },
      {
        title: "Standup",
        start: "2026-10-19T08:00:00.000Z",
        end: "2026-10-19T08:15:00.000Z",
        recurrenceId: "2026-10-19T08:00:00.000Z",
        recurring: true,
      },
      {
        title: "Standup (moved)",
        start: "2026-10-26T10:00:00.000Z",
        end: "2026-10-26T10:30:00.000Z",
        recurrenceId: "2026-10-26T09:00:00.000Z",
        recurring: true,
      },
      // 2 November is an EXDATE.
      {
        title: "Standup",
        start: "2026-11-09T09:00:00.000Z",
        end: "2026-11-09T09:15:00.000Z",
        recurrenceId: "2026-11-09T09:00:00.000Z",
        recurring: true,
      },
      {
        title: "Standup",
        start: "2026-11-16T09:00:00.000Z",
        end: "2026-11-16T09:15:00.000Z",
        recurrenceId: "2026-11-16T09:00:00.000Z",
        recurring: true,
      },
    ]);
  });

  test("only occurrences that overlap the window", async () => {
    const from = new Date("2026-11-09T09:10:00Z");
    const to = new Date("2026-11-10T00:00:00Z");

    const inside = await read("icloud-recurring.ics", { from, to });

    expect(inside.map((o) => o.start)).toEqual(["2026-11-09T09:00:00.000Z"]);
  });

  test("a moved instance with no master in the file is shown on its own", async () => {
    const ics = (await fixture("icloud-recurring.ics")).replace(
      /BEGIN:VEVENT[\s\S]*?RRULE[\s\S]*?END:VEVENT\n/,
      "",
    );

    const [moved] = readOccurrences(ics, window);

    expect(moved).toMatchObject({
      title: "Standup (moved)",
      recurrenceId: "2026-10-26T09:00:00.000Z",
    });
  });

  test("floating times are read in the server's zone", async () => {
    const [lunch] = await read("floating-overnight.ics", { floatingZone: "America/New_York" });

    expect(lunch).toMatchObject({
      title: "Floating lunch",
      start: "2026-11-14T17:00:00.000Z",
      timeZone: undefined,
    });
  });

  test("an event over midnight keeps both ends", async () => {
    const [, shift] = await read("floating-overnight.ics");

    expect(shift).toMatchObject({
      title: "Night shift",
      start: "2026-11-14T22:00:00.000Z",
      end: "2026-11-15T02:00:00.000Z",
    });
  });

  test("a Windows zone name from Outlook uses the file's VTIMEZONE", async () => {
    const [planning] = await read("outlook-windows-zone.ics");

    expect(planning).toMatchObject({
      title: "Quarterly planning",
      start: "2026-10-20T13:00:00.000Z",
      end: "2026-10-20T14:00:00.000Z",
      timeZone: "GMT Standard Time",
    });
  });

  test("text that isn't iCalendar throws", () => {
    expect(() => readOccurrences("<html>not a calendar</html>", window)).toThrow();
  });
});

describe("writeEvent", () => {
  const event = {
    uid: "4f1c2b@dashboardify",
    title: "Lunch with Sam",
    start: new Date("2026-11-11T12:30:00Z"),
    end: new Date("2026-11-11T13:30:00Z"),
    timeZone: "Europe/London",
    location: "Café; corner, by the park",
    now: new Date("2026-11-10T08:00:00Z"),
  };

  test("writes local times with a TZID, and escapes text", () => {
    const ics = writeEvent(event);

    expect(ics).toContain("DTSTART;TZID=Europe/London:20261111T123000");
    expect(ics).toContain("DTEND;TZID=Europe/London:20261111T133000");
    expect(ics).toContain("LOCATION:Café\\; corner\\, by the park");
    expect(ics).toContain("UID:4f1c2b@dashboardify");
    expect(ics).toContain("DTSTAMP:20261110T080000Z");
  });

  test("includes the zone's changes around the event", () => {
    const ics = writeEvent(event);

    expect(ics).toContain("BEGIN:VTIMEZONE\r\nTZID:Europe/London");
    expect(ics).toContain(
      "BEGIN:STANDARD\r\nDTSTART:20261025T020000\r\nTZOFFSETFROM:+0100\r\nTZOFFSETTO:+0000",
    );
    expect(ics).toContain(
      "BEGIN:DAYLIGHT\r\nDTSTART:20270328T010000\r\nTZOFFSETFROM:+0000\r\nTZOFFSETTO:+0100",
    );
  });

  test("round-trips through readOccurrences", () => {
    const [read] = readOccurrences(writeEvent(event), window);

    expect(read).toMatchObject({
      uid: event.uid,
      title: event.title,
      location: event.location,
      start: event.start,
      end: event.end,
      timeZone: "Europe/London",
      recurring: false,
    });
  });

  test("the VTIMEZONE alone gives the right times, for a reader without IANA zones", () => {
    // Rename the zone so only the written VTIMEZONE can explain the offset.
    const ics = writeEvent({
      ...event,
      start: new Date("2026-07-01T08:00:00Z"),
      end: new Date("2026-07-01T09:00:00Z"),
    }).replaceAll("Europe/London", "Custom/London");

    const [read] = readOccurrences(ics, {
      ...window,
      to: new Date("2027-01-01T00:00:00Z"),
      from: new Date("2026-06-01T00:00:00Z"),
    });

    expect(read?.start.toISOString()).toBe("2026-07-01T08:00:00.000Z");
  });

  test("leaves out empty optional fields", () => {
    const ics = writeEvent({ ...event, location: undefined });

    expect(ics).not.toContain("LOCATION");
    expect(ics).not.toContain("DESCRIPTION");
  });
});

describe("editEvent", () => {
  const now = new Date("2026-11-11T09:00:00Z");

  test("changes the given fields and keeps everything else the server stored", async () => {
    const ics = (await fixture("icloud-timed.ics")).replace(
      "END:VEVENT",
      "BEGIN:VALARM\nACTION:DISPLAY\nTRIGGER:-PT15M\nEND:VALARM\nEND:VEVENT",
    );

    const edited = editEvent(ics, {
      title: "Physio, shoulder",
      start: new Date("2026-11-12T19:00:00Z"),
      end: new Date("2026-11-12T20:00:00Z"),
      timeZone: "Europe/London",
      now,
    });
    const [read] = readOccurrences(edited, window);

    expect(read).toMatchObject({
      title: "Physio, shoulder",
      location: "Northside Clinic\n12 High St",
      start: new Date("2026-11-12T19:00:00Z"),
      timeZone: "America/Los_Angeles",
    });
    expect(edited).toContain("DTSTART;TZID=America/Los_Angeles:20261112T110000");
    expect(edited).toContain("TRIGGER:-PT15M");
    expect(edited).toContain("X-APPLE-TRAVEL-ADVISORY-BEHAVIOR:AUTOMATIC");
    expect(edited).toContain("SEQUENCE:1");
  });

  test("an empty string clears a field", async () => {
    const edited = editEvent(await fixture("icloud-timed.ics"), {
      location: "",
      timeZone: "UTC",
      now,
    });

    expect(edited).not.toMatch(/^LOCATION/m);
  });

  test("refuses recurring events and the dates of all-day ones", async () => {
    expect(() => editEvent(fixtureText.recurring, { title: "x", timeZone: "UTC", now })).toThrow(
      NotEditable,
    );
    expect(() =>
      editEvent(fixtureText.allDay, {
        start: now,
        end: new Date(now.getTime() + 1),
        timeZone: "UTC",
        now,
      }),
    ).toThrow(NotEditable);
  });
});

const fixtureText = {
  recurring: await fixture("icloud-recurring.ics"),
  allDay: await fixture("icloud-all-day.ics"),
};
