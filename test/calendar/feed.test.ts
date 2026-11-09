import { describe, expect, test } from "bun:test";
import { FeedError, FeedGone, feedName, feedUrl, fetchFeed } from "../../src/calendar/feed";

const ICS = "BEGIN:VCALENDAR\r\nVERSION:2.0\r\nX-WR-CALNAME:Acme work\r\nEND:VCALENDAR\r\n";

function server(handler: (request: Request) => Response) {
  const seen: Request[] = [];
  const fetch = (request: Request) => {
    seen.push(request);
    return Promise.resolve(handler(request));
  };
  return { seen, fetch };
}

describe("feedUrl", () => {
  test("reads webcal as https and refuses http", () => {
    expect(feedUrl("webcal://outlook.office365.com/x/calendar.ics").href).toBe(
      "https://outlook.office365.com/x/calendar.ics",
    );
    expect(() => feedUrl("http://example.com/cal.ics")).toThrow(FeedError);
    expect(() => feedUrl("not a link")).toThrow(FeedError);
  });
});

describe("fetchFeed", () => {
  test("returns the calendar with its validators", async () => {
    const { fetch } = server(
      () =>
        new Response(ICS, {
          headers: { etag: '"v1"', "last-modified": "Tue, 10 Nov 2026 08:00:00 GMT" },
        }),
    );

    expect(await fetchFeed("https://cal.example.com/a.ics", {}, fetch)).toEqual({
      kind: "ok",
      ics: ICS,
      etag: '"v1"',
      lastModified: "Tue, 10 Nov 2026 08:00:00 GMT",
    });
  });

  test("an unchanged feed is one conditional request", async () => {
    const { seen, fetch } = server(
      (r) => new Response(null, { status: r.headers.get("if-none-match") === '"v1"' ? 304 : 200 }),
    );

    const result = await fetchFeed("https://cal.example.com/a.ics", { etag: '"v1"' }, fetch);

    expect(result).toEqual({ kind: "not-modified" });
    expect(seen).toHaveLength(1);
  });

  test("follows https redirects, refuses one to http", async () => {
    const ok = server((r) =>
      r.url.endsWith("/old")
        ? new Response(null, { status: 302, headers: { location: "https://cdn.example.com/new" } })
        : new Response(ICS),
    );
    const bad = server(
      () =>
        new Response(null, { status: 302, headers: { location: "http://cdn.example.com/new" } }),
    );

    expect((await fetchFeed("https://cal.example.com/old", {}, ok.fetch)).kind).toBe("ok");
    await expect(fetchFeed("https://cal.example.com/old", {}, bad.fetch)).rejects.toBeInstanceOf(
      FeedError,
    );
    expect(bad.seen).toHaveLength(1);
  });

  test("a link taken down is FeedGone, and errors name only the host", async () => {
    const { fetch } = server(() => new Response("gone", { status: 410 }));

    const error = await fetchFeed(
      "https://cal.example.com/secret-token-abc/a.ics",
      {},
      fetch,
    ).catch((e: Error) => e);

    expect(error).toBeInstanceOf(FeedGone);
    expect((error as Error).message).toContain("cal.example.com");
    expect((error as Error).message).not.toContain("secret-token-abc");
  });

  test("a web page isn't a calendar", async () => {
    const { fetch } = server(() => new Response("<html>Outlook</html>"));

    await expect(fetchFeed("https://cal.example.com/a.html", {}, fetch)).rejects.toThrow(
      "isn't a calendar feed",
    );
  });

  test("a feed over 10 MB is refused", async () => {
    const { fetch } = server(
      () => new Response(`BEGIN:VCALENDAR\r\n${"X".repeat(11 * 1024 * 1024)}`),
    );

    await expect(fetchFeed("https://cal.example.com/a.ics", {}, fetch)).rejects.toThrow(
      "over 10 MB",
    );
  });

  test("feedName reads X-WR-CALNAME", () => {
    expect(feedName(ICS)).toBe("Acme work");
    expect(feedName("BEGIN:VCALENDAR\r\nEND:VCALENDAR")).toBeUndefined();
  });
});
