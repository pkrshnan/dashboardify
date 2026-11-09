import { beforeEach, describe, expect, test } from "bun:test";
import { FakeCalDav } from "../../calendar/fake-caldav";
import { useApi } from "./helpers";

// The helper's clock: Tuesday 3 November 2026, 12:00 UTC, and the server's zone is UTC.
let server: FakeCalDav;

describe("capture API with a calendar", () => {
  const api = useApi({ calDav: () => server });

  beforeEach(async () => {
    server = new FakeCalDav([
      { id: "home", displayName: "Personal" },
      { id: "work", displayName: "Work" },
      { id: "dinners", displayName: "Dinners with Alex", writable: false },
    ]);
    await api.call("/v1/calendarAccounts", "POST", {
      kind: "KIND_CALDAV",
      provider: "icloud",
      username: server.username,
      password: server.password,
    });
    await api.sync.tick();
  });

  test("an event goes to iCloud, on the default calendar", async () => {
    const { status, body } = await api.call("/v1/captures", "POST", {
      text: "Lunch with Sam tomorrow 12:30–13:30",
      requestId: "c1",
    });

    expect(status).toBe(200);
    expect(body.parse).toMatchObject({
      kind: "CAPTURE_KIND_EVENT",
      title: "Lunch with Sam",
      startTime: "2026-11-04T12:30:00Z",
      endTime: "2026-11-04T13:30:00Z",
      calendar: "calendarAccounts/icloud/calendars/home",
      calendarReason: "Your default calendar.",
    });
    expect(body.event.name).toMatch(/^events\//);
    expect(body.message).toBe("Added Lunch with Sam to Personal, Wed 4 Nov 12:30–13:30.");
    expect(server.event("home", "c1.ics")?.ics).toContain("SUMMARY:Lunch with Sam");
  });

  test("a reminder becomes a task in the inbox", async () => {
    const { body } = await api.call("/v1/captures", "POST", {
      text: "Call dentist Fri 10:00",
      requestId: "c2",
    });

    expect(body.parse.kind).toBe("CAPTURE_KIND_REMINDER");
    expect(body.task.name).toMatch(/^tasks\//);
    expect(body.message).toBe("Added Call dentist to Inbox, Fri 6 Nov 10:00.");
    expect(await api.vaultFile("Inbox.md")).toContain("- [ ] Call dentist ⏰ 10:00 📅 2026-11-06");
  });

  test("a kind switched by hand wins", async () => {
    const { body } = await api.call("/v1/captures", "POST", {
      text: "Coffee with Priya Thu 3pm",
      kind: "CAPTURE_KIND_REMINDER",
    });

    expect(body.parse.kind).toBe("CAPTURE_KIND_REMINDER");
    expect(await api.vaultFile("Inbox.md")).toContain("Coffee with Priya ⏰ 15:00 📅 2026-11-05");
  });

  test("a calendar picked by hand wins, if it is writable", async () => {
    const work = await api.call("/v1/captures", "POST", {
      text: "Design review Thu 2-3pm",
      calendar: "calendarAccounts/icloud/calendars/work",
      requestId: "c3",
    });
    const readOnly = await api.call("/v1/captures", "POST", {
      text: "Dinner Fri 7-9pm",
      calendar: "calendarAccounts/icloud/calendars/dinners",
    });

    expect(work.body.parse.calendarReason).toBe("Picked by hand.");
    expect(server.event("work", "c3.ics")).toBeDefined();
    expect(readOnly.status).toBe(400);
  });

  test("the server's clock and zone decide the day", async () => {
    const { body } = await api.call("/v1/captures:parse", "POST", {
      text: "Gym today 18:00 for 1h",
    });

    expect(body).toMatchObject({
      startTime: "2026-11-03T18:00:00Z",
      endTime: "2026-11-03T19:00:00Z",
    });
    expect(server.event("home", "x.ics")).toBeUndefined();
  });

  test("retries with the same request id make one event and one task", async () => {
    const event = { text: "Lunch with Sam tomorrow 12:30–13:30", requestId: "e1" };
    const task = { text: "Pay rent Friday", requestId: "t1" };

    const first = await api.call("/v1/captures", "POST", event);
    const again = await api.call("/v1/captures", "POST", event);
    await api.call("/v1/captures", "POST", task);
    await api.call("/v1/captures", "POST", task);

    expect(again.body.event.name).toBe(first.body.event.name);
    expect((await api.vaultFile("Inbox.md")).match(/Pay rent/g)).toHaveLength(1);
  });

  test("a line that is only a time is refused", async () => {
    const { status, body } = await api.call("/v1/captures", "POST", { text: "tomorrow 3pm" });

    expect(status).toBe(400);
    expect(body.message).toBe("Say what it is, not just when.");
  });
});

describe("capture API without a calendar", () => {
  const api = useApi();

  test("a line that reads as an event becomes a reminder", async () => {
    const { body } = await api.call("/v1/captures", "POST", {
      text: "Lunch with Sam tomorrow 12:30–13:30",
    });

    expect(body.parse.kind).toBe("CAPTURE_KIND_REMINDER");
    expect(body.task.name).toMatch(/^tasks\//);
  });

  test("an explicit Event says to connect a calendar", async () => {
    const { status, body } = await api.call("/v1/captures", "POST", {
      text: "Lunch with Sam tomorrow 12:30–13:30",
      kind: "CAPTURE_KIND_EVENT",
    });

    expect(status).toBe(400);
    expect(body).toMatchObject({
      code: "failed_precondition",
      message: "Connect a calendar in Settings to add events.",
    });
  });
});
