import { beforeEach, describe, expect, test } from "bun:test";
import { FakeCalDav } from "../../calendar/fake-caldav";
import { useApi } from "./helpers";

let server: FakeCalDav;
const HOME = "calendarAccounts/icloud/calendars/home";

const lunch = {
  calendar: HOME,
  title: "Lunch with Sam",
  startTime: "2026-11-12T12:30:00Z",
  endTime: "2026-11-12T13:30:00Z",
};

const weekly =
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:standup\r\nDTSTAMP:20261101T000000Z\r\n" +
  "DTSTART:20261109T100000Z\r\nDTEND:20261109T101500Z\r\nRRULE:FREQ=WEEKLY\r\nSUMMARY:Standup\r\n" +
  "END:VEVENT\r\nEND:VCALENDAR\r\n";

describe("events API", () => {
  const api = useApi({ calDav: () => server });

  beforeEach(async () => {
    server = new FakeCalDav([
      { id: "home", displayName: "Personal" },
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

  const list = async () => {
    const { body } = await api.call(
      `/v1/events?filter=${encodeURIComponent('end_time > "2026-11-01T00:00:00Z" AND start_time < "2026-12-01T00:00:00Z"')}`,
    );
    return body.events ?? [];
  };

  test("create writes the event to iCloud and returns it from the cache", async () => {
    const { status, body } = await api.call("/v1/events?requestId=r1", "POST", lunch);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      name: expect.stringMatching(/^events\/[a-z2-7]{16}$/),
      title: "Lunch with Sam",
      uid: "r1@dashboardify",
      writable: true,
    });
    expect(body.etag).toBe(server.event("home", "r1.ics")?.etag ?? "missing");
    expect(server.event("home", "r1.ics")?.ics).toContain("SUMMARY:Lunch with Sam");
    expect((await list()).map((e: { title: string }) => e.title)).toEqual(["Lunch with Sam"]);
  });

  test("a retry with the same request id makes one event", async () => {
    const first = await api.call("/v1/events?requestId=r1", "POST", lunch);
    const again = await api.call("/v1/events?requestId=r1", "POST", lunch);

    expect(again.status).toBe(200);
    expect(again.body.name).toBe(first.body.name);
    expect(await list()).toHaveLength(1);
  });

  test("writes times in the event's zone, or the server's", async () => {
    await api.call("/v1/events?requestId=london", "POST", { ...lunch, timeZone: "Europe/London" });
    await api.call("/v1/events?requestId=default", "POST", lunch);

    expect(server.event("home", "london.ics")?.ics).toContain(
      "DTSTART;TZID=Europe/London:20261112T123000",
    );
    expect(server.event("home", "default.ics")?.ics).toContain("DTSTART;TZID=UTC:20261112T123000");
  });

  test("a read-only calendar is PERMISSION_DENIED", async () => {
    const { status, body } = await api.call("/v1/events", "POST", {
      ...lunch,
      calendar: "calendarAccounts/icloud/calendars/dinners",
    });

    expect(status).toBe(403);
    expect(body.code).toBe("permission_denied");
  });

  test("an end before the start is INVALID_ARGUMENT", async () => {
    const { status } = await api.call("/v1/events", "POST", { ...lunch, endTime: lunch.startTime });

    expect(status).toBe(400);
  });

  test("update changes the event in iCloud", async () => {
    const created = await api.call("/v1/events?requestId=r1", "POST", lunch);

    const { status, body } = await api.call(
      `/v1/${created.body.name}?updateMask=title,startTime,endTime`,
      "PATCH",
      {
        title: "Lunch with Sam and Jo",
        startTime: "2026-11-12T13:00:00Z",
        endTime: "2026-11-12T14:00:00Z",
      },
    );

    expect(status).toBe(200);
    expect(body).toMatchObject({
      title: "Lunch with Sam and Jo",
      startTime: "2026-11-12T13:00:00Z",
    });
    expect(server.event("home", "r1.ics")?.ics).toContain("SEQUENCE:1");
  });

  test("a place is written with coordinates, and updating the location drops them", async () => {
    const place = {
      displayName: "Dishoom",
      address: "7 Boundary Street, London",
      location: { latitude: 51.5245, longitude: -0.0773 },
    };
    const created = await api.call("/v1/events?requestId=r1", "POST", { ...lunch, place });
    const placed = server.event("home", "r1.ics")?.ics ?? "";

    const updated = await api.call(`/v1/${created.body.name}?updateMask=location`, "PATCH", {
      location: "Sam's flat",
    });
    const typed = server.event("home", "r1.ics")?.ics ?? "";

    expect(created.body.location).toBe("Dishoom\n7 Boundary Street, London");
    expect(placed).toContain("GEO:51.5245;-0.0773");
    expect(updated.body.location).toBe("Sam's flat");
    expect(typed).not.toContain("GEO");
  });

  test("an update after a change in Apple Calendar is ABORTED", async () => {
    const created = await api.call("/v1/events?requestId=r1", "POST", lunch);
    const changed =
      server.event("home", "r1.ics")?.ics.replace("Lunch with Sam", "Lunch, moved") ?? "";
    server.putEvent("home", "r1.ics", changed);

    const { status, body } = await api.call(`/v1/${created.body.name}?updateMask=title`, "PATCH", {
      title: "Lunch at one",
      etag: created.body.etag,
    });

    expect(status).toBe(409);
    expect(body.code).toBe("aborted");
  });

  test("recurring events can't be changed or deleted here", async () => {
    server.putEvent("home", "standup.ics", weekly);
    await api.call("/v1/calendarAccounts/icloud:sync", "POST", {});
    await api.sync.tick();
    const [standup] = await list();

    const update = await api.call(`/v1/${standup.name}?updateMask=title`, "PATCH", { title: "x" });
    const remove = await api.call(`/v1/${standup.name}`, "DELETE");

    expect(standup.recurring).toBe(true);
    expect(standup.writable).toBeUndefined();
    expect([update.status, update.body.code]).toEqual([400, "failed_precondition"]);
    expect([remove.status, remove.body.code]).toEqual([400, "failed_precondition"]);
  });

  test("delete removes the event from iCloud and the cache", async () => {
    const created = await api.call("/v1/events?requestId=r1", "POST", lunch);

    const { status } = await api.call(`/v1/${created.body.name}`, "DELETE");

    expect(status).toBe(200);
    expect(server.event("home", "r1.ics")).toBeUndefined();
    expect(await list()).toEqual([]);
  });

  test("deleting an event already gone from iCloud succeeds", async () => {
    const created = await api.call("/v1/events?requestId=r1", "POST", lunch);
    server.removeEvent("home", "r1.ics");

    const { status } = await api.call(`/v1/${created.body.name}`, "DELETE");

    expect(status).toBe(200);
  });

  test("iCloud being unreachable is UNAVAILABLE", async () => {
    server = {
      fetch: () => Promise.reject(new TypeError("fetch failed")),
    } as unknown as FakeCalDav;

    const { status, body } = await api.call("/v1/events", "POST", lunch);

    expect(status).toBe(503);
    expect(body.code).toBe("unavailable");
  });

  test("get and Connect read from the cache", async () => {
    const created = await api.call("/v1/events?requestId=r1", "POST", lunch);

    const got = await api.call(`/v1/${created.body.name}`);
    const rpc = await api.call("/dashboardify.v1.EventService/GetEvent", "POST", {
      name: created.body.name,
    });

    expect(got.body.title).toBe("Lunch with Sam");
    expect(rpc.body.title).toBe("Lunch with Sam");
  });
});
