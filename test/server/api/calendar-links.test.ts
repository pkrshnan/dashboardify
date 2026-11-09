import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";
import { expectNotInResponses } from "./secrets";

const SECRET = "reachcalendar-abc123";
const URL_ = `https://outlook.office365.com/owa/calendar/${SECRET}/calendar.ics`;
let feed = "";
let status = 200;

const ics = (title: string) =>
  "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Acme work\r\nBEGIN:VEVENT\r\nUID:q1\r\n" +
  `DTSTAMP:20261101T000000Z\r\nDTSTART:20261105T100000Z\r\nDTEND:20261105T110000Z\r\nSUMMARY:${title}\r\n` +
  "END:VEVENT\r\nEND:VCALENDAR\r\n";

const link = (feedUrl = URL_) => ({ kind: "KIND_ICS", feedUrl });

describe("calendar links API", () => {
  const api = useApi({
    feeds: (request) =>
      request.url.includes(SECRET)
        ? new Response(status === 200 ? feed : "", { status })
        : new Response("<html>", { status: 200 }),
  });

  test("validate_only reads the feed's name and counts its events, saving nothing", async () => {
    feed = ics("Quarterly planning");

    const { status: code, body } = await api.call(
      "/v1/calendarAccounts?validateOnly=true",
      "POST",
      link("webcal://outlook.office365.com/owa/calendar/reachcalendar-abc123/calendar.ics"),
    );
    const listed = await api.call("/v1/calendarAccounts");

    expect(code).toBe(200);
    expect(body).toMatchObject({
      kind: "KIND_ICS",
      displayName: "Acme work",
      feedHost: "outlook.office365.com",
      eventCount: 1,
    });
    expect(listed.body.calendarAccounts).toBeUndefined();
  });

  test("a saved link is read-only, shows its events, and never returns its URL", async () => {
    feed = ics("Quarterly planning");

    const created = await api.call("/v1/calendarAccounts", "POST", {
      ...link(),
      displayName: "Work",
    });
    await api.sync.tick();
    const events = await api.call(
      `/v1/events?filter=${encodeURIComponent('end_time > "2026-11-01T00:00:00Z" AND start_time < "2026-11-10T00:00:00Z"')}`,
    );
    const listed = await api.call("/v1/calendarAccounts");
    const calendars = await api.call("/v1/calendarAccounts/work/calendars");

    expect(created.body).toMatchObject({
      name: "calendarAccounts/work",
      kind: "KIND_ICS",
      feedUrlSet: true,
      feedHost: "outlook.office365.com",
    });
    expect(events.body.events.map((e: { title: string }) => e.title)).toEqual([
      "Quarterly planning",
    ]);
    expect(events.body.events[0].writable).toBeUndefined();
    expect(calendars.body.calendars[0].writable).toBeUndefined();
    expectNotInResponses([created.body, listed.body, calendars.body, events.body], SECRET);
  });

  test("the URL is stored sealed", async () => {
    feed = ics("x");
    await api.call("/v1/calendarAccounts", "POST", link());

    const row = api.settings.db
      .query<{ feed_url_sealed: Uint8Array }, []>("SELECT feed_url_sealed FROM calendar_accounts")
      .get();

    expect(Buffer.from(row?.feed_url_sealed ?? []).includes(Buffer.from(SECRET))).toBe(false);
  });

  test("a link's calendar can't take events, be the default, or be a rule's target", async () => {
    feed = ics("x");
    await api.call("/v1/calendarAccounts", "POST", { ...link(), displayName: "Work" });
    const name = "calendarAccounts/work/calendars/feed";

    const write = await api.call("/v1/events", "POST", {
      calendar: name,
      title: "x",
      startTime: "2026-11-05T10:00:00Z",
      endTime: "2026-11-05T11:00:00Z",
    });
    const asDefault = await api.call("/v1/calendarSettings", "PATCH", { defaultCalendar: name });
    const asRule = await api.call("/v1/calendarSettings", "PATCH", {
      keywordRules: [{ words: ["q"], calendar: name }],
    });

    expect([write.status, asDefault.status, asRule.status]).toEqual([403, 400, 400]);
  });

  test("http, a web page and a link that's gone are refused at add, naming only the host", async () => {
    feed = ics("x");
    const http = await api.call(
      "/v1/calendarAccounts",
      "POST",
      link(URL_.replace("https", "http")),
    );
    const page = await api.call(
      "/v1/calendarAccounts",
      "POST",
      link("https://outlook.office365.com/owa/calendar/x/calendar.html"),
    );
    status = 404;
    const gone = await api.call("/v1/calendarAccounts", "POST", link());
    status = 200;

    expect([http.status, page.status, gone.status]).toEqual([400, 400, 400]);
    expect(page.body.message).toContain("isn't a calendar feed");
    expect(gone.body.message).not.toContain(SECRET);
  });

  test("a link that stops working is marked, and the account stays", async () => {
    feed = ics("x");
    await api.call("/v1/calendarAccounts", "POST", { ...link(), displayName: "Work" });
    status = 410;

    await api.sync.tick();
    const { body } = await api.call("/v1/calendarAccounts/work");
    status = 200;

    expect(body.status).toBe("STATUS_UNREACHABLE");
    expect(body.statusDetail).toContain("Link stopped working");
  });

  test("links don't count toward the one iCloud account", async () => {
    feed = ics("x");

    const first = await api.call("/v1/calendarAccounts", "POST", {
      ...link(),
      displayName: "Work",
    });
    const second = await api.call("/v1/calendarAccounts", "POST", {
      ...link(),
      displayName: "Climbing club",
    });

    expect([first.status, second.status]).toEqual([200, 200]);
    expect(second.body.name).toBe("calendarAccounts/climbing-club");
  });
});
