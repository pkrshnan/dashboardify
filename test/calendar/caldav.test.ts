import { beforeEach, describe, expect, test } from "bun:test";
import {
  CalDavClient,
  PreconditionFailed,
  Unauthorized,
  UnsafeRedirect,
} from "../../src/calendar/caldav";
import { FakeCalDav } from "./fake-caldav";

const ICS = (uid: string, title: string) =>
  `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nBEGIN:VEVENT\r\nUID:${uid}\r\nDTSTAMP:20261101T000000Z\r\n` +
  `DTSTART:20261112T100000Z\r\nDTEND:20261112T110000Z\r\nSUMMARY:${title}\r\nEND:VEVENT\r\nEND:VCALENDAR\r\n`;

let server: FakeCalDav;
let client: CalDavClient;

function clientFor(password = server.password) {
  return new CalDavClient(
    {
      serverUrl: server.serverUrl,
      username: server.username,
      password,
      allowedDomains: ["icloud.com"],
    },
    server.fetch,
  );
}

beforeEach(() => {
  server = new FakeCalDav([
    { id: "home", displayName: "Personal" },
    { id: "work", displayName: "Work & Projects", color: "#0A84FFFF" },
    { id: "dinners", displayName: "Dinners with Alex", writable: false },
    { id: "reminders", displayName: "Reminders", components: ["VTODO"] },
  ]);
  client = clientFor();
});

describe("discovery", () => {
  test("finds the calendar home on the data host", async () => {
    expect(await client.discover()).toBe(server.homeUrl);
  });

  test("follows a redirect within icloud.com", async () => {
    server.rootRedirect = "https://p42-caldav.icloud.com/";

    expect(await client.discover()).toBe(server.homeUrl);
    expect(server.requests.slice(0, 2)).toEqual([
      "PROPFIND caldav.icloud.com/",
      "PROPFIND p42-caldav.icloud.com/",
    ]);
  });

  test("refuses a redirect to another domain, before sending anything there", async () => {
    server.rootRedirect = "https://caldav.example.com/";

    await expect(client.discover()).rejects.toBeInstanceOf(UnsafeRedirect);
    expect(server.requests.some((r) => r.includes("example.com"))).toBe(false);
  });

  test("refuses a redirect to plain HTTP", async () => {
    server.rootRedirect = "http://p42-caldav.icloud.com/";

    await expect(client.discover()).rejects.toBeInstanceOf(UnsafeRedirect);
  });

  test("a wrong password is Unauthorized", async () => {
    await expect(clientFor("wrong").discover()).rejects.toBeInstanceOf(Unauthorized);
  });
});

describe("listCalendars", () => {
  test("lists event calendars with names, colours and write access", async () => {
    const calendars = await client.listCalendars(server.homeUrl);

    expect(
      calendars.map(({ displayName, color, writable }) => ({ displayName, color, writable })),
    ).toEqual([
      { displayName: "Personal", color: "#FF2968FF", writable: true },
      { displayName: "Work & Projects", color: "#0A84FFFF", writable: true },
      { displayName: "Dinners with Alex", color: "#FF2968FF", writable: false },
    ]);
    expect(calendars[0]?.url).toBe(server.calendarUrl("home"));
    expect(calendars[0]?.ctag).toBe("ctag-1");
  });

  test("the ctag moves when an event changes", async () => {
    server.putEvent("home", "a.ics", ICS("a", "Physio"));

    const [home] = await client.listCalendars(server.homeUrl);

    expect(home?.ctag).toBe("ctag-2");
  });
});

describe("sync", () => {
  const url = () => server.calendarUrl("home");

  test("with no token, returns everything and a token", async () => {
    server.putEvent("home", "a.ics", ICS("a", "Physio"));
    server.putEvent("home", "b.ics", ICS("b", "Lunch"));

    const result = await client.sync(url(), undefined);

    expect(result.kind).toBe("changes");
    if (result.kind === "changes") {
      expect(result.changed.map((r) => r.url)).toEqual([`${url()}a.ics`, `${url()}b.ics`]);
      expect(result.deleted).toEqual([]);
      expect(result.syncToken).toBeTruthy();
    }
  });

  test("with a token, returns only what changed and what was deleted", async () => {
    server.putEvent("home", "a.ics", ICS("a", "Physio"));
    server.putEvent("home", "b.ics", ICS("b", "Lunch"));
    const first = await client.sync(url(), undefined);
    const token = first.kind === "changes" ? first.syncToken : "";
    server.putEvent("home", "a.ics", ICS("a", "Physio, moved"));
    server.removeEvent("home", "b.ics");

    const second = await client.sync(url(), token);

    expect(second).toMatchObject({
      kind: "changes",
      changed: [{ url: `${url()}a.ics` }],
      deleted: [`${url()}b.ics`],
    });
  });

  test("an expired token says so, and listResources gives everything to compare", async () => {
    server.putEvent("home", "a.ics", ICS("a", "Physio"));
    const first = await client.sync(url(), undefined);
    server.expireTokens();

    const result = await client.sync(url(), first.kind === "changes" ? first.syncToken : "");
    const all = await client.listResources(url());

    expect(result).toEqual({ kind: "token-expired" });
    expect(all).toEqual([
      { url: `${url()}a.ics`, etag: server.event("home", "a.ics")?.etag ?? "" },
    ]);
  });
});

describe("fetchResources", () => {
  test("returns the iCalendar text, unescaped", async () => {
    server.putEvent("home", "a.ics", ICS("a", "Fish & chips <takeaway>"));

    const [resource] = await client.fetchResources(server.calendarUrl("home"), [
      `${server.calendarUrl("home")}a.ics`,
    ]);

    expect(resource?.ics).toContain("SUMMARY:Fish & chips <takeaway>");
    expect(resource?.etag).toBe(server.event("home", "a.ics")?.etag ?? "missing");
  });

  test("asks for nothing when given nothing", async () => {
    expect(await client.fetchResources(server.calendarUrl("home"), [])).toEqual([]);
    expect(server.requests).toEqual([]);
  });
});

describe("writes", () => {
  const event = () => `${server.calendarUrl("home")}r1.ics`;

  test("create returns the new etag", async () => {
    const { etag } = await client.put(event(), ICS("r1", "Lunch"));

    expect(etag).toBe(server.event("home", "r1.ics")?.etag ?? "missing");
  });

  test("a retried create fails its precondition instead of making a second copy", async () => {
    await client.put(event(), ICS("r1", "Lunch"));

    await expect(client.put(event(), ICS("r1", "Lunch"))).rejects.toBeInstanceOf(
      PreconditionFailed,
    );
  });

  test("an update with a stale etag fails its precondition", async () => {
    const { etag } = await client.put(event(), ICS("r1", "Lunch"));
    server.putEvent("home", "r1.ics", ICS("r1", "Lunch, edited on the phone"));

    await expect(client.put(event(), ICS("r1", "Lunch at 1"), etag)).rejects.toBeInstanceOf(
      PreconditionFailed,
    );
  });

  test("an update with the current etag replaces it", async () => {
    const { etag } = await client.put(event(), ICS("r1", "Lunch"));

    await client.put(event(), ICS("r1", "Lunch at 1"), etag);

    expect(server.event("home", "r1.ics")?.ics).toContain("Lunch at 1");
  });

  test("delete needs the current etag", async () => {
    const { etag } = await client.put(event(), ICS("r1", "Lunch"));

    await expect(client.delete(event(), '"stale"')).rejects.toBeInstanceOf(PreconditionFailed);
    await client.delete(event(), etag ?? "");

    expect(server.event("home", "r1.ics")).toBeUndefined();
  });

  test("a read-only calendar refuses writes", async () => {
    await expect(
      client.put(`${server.calendarUrl("dinners")}x.ics`, ICS("x", "Dinner")),
    ).rejects.toMatchObject({ status: 403 });
  });
});
