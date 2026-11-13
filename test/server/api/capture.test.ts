import { beforeEach, describe, expect, test } from "bun:test";
import { FakeCalDav } from "../../calendar/fake-caldav";
import { DISHOOM, FakePhoton } from "../../places/fake-photon";
import { useApi } from "./helpers";

// The helper's clock: Tuesday 3 November 2026, 12:00 UTC, and the server's zone is UTC.
let server: FakeCalDav;
let photon: FakePhoton;

describe("capture API with a calendar", () => {
  const api = useApi({ calDav: () => server, photon: () => photon });

  beforeEach(async () => {
    photon = new FakePhoton();
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

  test("at a place, the event gets the best match with its coordinates", async () => {
    const { body } = await api.call("/v1/captures", "POST", {
      text: "Lunch with Sam at Dishoom tomorrow 1pm",
      requestId: "p1",
    });
    const ics = server.event("home", "p1.ics")?.ics.replace(/\r\n /g, "") ?? "";

    expect(body.parse).toMatchObject({
      title: "Lunch with Sam",
      location: "Dishoom",
      place: { displayName: "Dishoom", location: { latitude: DISHOOM.lat } },
    });
    expect(body.message).toBe(
      "Added Lunch with Sam to Personal, Wed 4 Nov 13:00–14:00, at Dishoom.",
    );
    expect(ics).toContain("LOCATION:Dishoom\\n7 Boundary Street\\, London\\, United Kingdom");
    expect(ics).toContain("GEO:51.5245;-0.0773");
  });

  test("the place the box showed wins over a new search", async () => {
    await api.call("/v1/captures", "POST", {
      text: "Coffee @Barbican Thu 3pm",
      requestId: "p2",
      place: {
        displayName: "Barbican Centre",
        address: "Silk Street, London",
        location: { latitude: 51.52, longitude: -0.09 },
      },
    });

    expect(photon.requests).toHaveLength(0);
    expect(server.event("home", "p2.ics")?.ics).toContain("GEO:51.52;-0.09");
  });

  test("a place search that fails or finds nothing keeps the typed location", async () => {
    photon.status = 502;

    const { status } = await api.call("/v1/captures", "POST", {
      text: "Dinner at Nowhere Special Fri 7-9pm",
      requestId: "p3",
    });
    const ics = server.event("home", "p3.ics")?.ics ?? "";

    expect(status).toBe(200);
    expect(ics).toContain("LOCATION:Nowhere Special");
    expect(ics).not.toContain("GEO");
  });

  test("a reminder becomes a task in the inbox", async () => {
    const { body } = await api.call("/v1/captures", "POST", {
      text: "Call dentist Fri 10:00",
      requestId: "c2",
    });

    expect(body.parse.kind).toBe("CAPTURE_KIND_REMINDER");
    expect(body.task.name).toMatch(/^tasks\//);
    expect(body.message).toBe("Added Call dentist to Inbox, Fri 6 Nov 10:00.");
    expect(await api.vaultFile("Inbox.md")).toMatch(
      /^- \[ \] Call dentist <!-- id:\w+ -->\n\t- due: 2026-11-06 10:00\n/,
    );
  });

  test("a kind switched by hand wins", async () => {
    const { body } = await api.call("/v1/captures", "POST", {
      text: "Coffee with Priya Thu 3pm",
      kind: "CAPTURE_KIND_REMINDER",
    });

    expect(body.parse.kind).toBe("CAPTURE_KIND_REMINDER");
    expect(await api.vaultFile("Inbox.md")).toMatch(
      /Coffee with Priya <!-- id:\w+ -->\n\t- due: 2026-11-05 15:00\n/,
    );
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
