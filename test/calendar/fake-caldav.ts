// An in-memory CalDAV server shaped like iCloud, for tests and the demo. Discovery starts on
// caldav.icloud.com and the calendar home lives on a pNN-caldav host, as iCloud's does. It keeps
// ctags, sync tokens and etags, checks If-Match and If-None-Match, refuses writes to read-only
// calendars and answers 401 to a wrong password. Request bodies are matched loosely: this is a
// stand-in for iCloud, not a CalDAV implementation.

export interface FakeCalendar {
  id: string;
  displayName: string;
  color?: string;
  writable?: boolean;
  /** "VTODO" makes it a Reminders list, which clients should skip. */
  components?: string[];
}

interface Stored {
  ics: string;
  etag: string;
}

interface Collection extends Required<FakeCalendar> {
  resources: Map<string, Stored>;
  ctag: number;
  /** Change log: the sync token after each change, and the resource it touched. */
  log: { token: number; name: string }[];
  /** Tokens below this are forgotten, as a server does after a while. */
  oldestToken: number;
}

const DISCOVERY_HOST = "caldav.icloud.com";
const DATA_HOST = "p42-caldav.icloud.com";
const PRINCIPAL = "/1234567/principal/";
const HOME = "/1234567/calendars/";

export class FakeCalDav {
  username = "you@icloud.com";
  password = "abcd-efgh-ijkl-mnop";
  /** When set, a PROPFIND on the discovery root answers 301 to this URL first. */
  rootRedirect?: string;
  /** Every request, as "METHOD host/path", for asserting how many were made. */
  readonly requests: string[] = [];
  private readonly calendars = new Map<string, Collection>();
  private token = 1;
  private nextEtag = 1;

  constructor(calendars: FakeCalendar[] = []) {
    for (const calendar of calendars) {
      this.addCalendar(calendar);
    }
  }

  readonly serverUrl = `https://${DISCOVERY_HOST}/`;
  readonly homeUrl = `https://${DATA_HOST}${HOME}`;

  calendarUrl(id: string): string {
    return `${this.homeUrl}${id}/`;
  }

  addCalendar(calendar: FakeCalendar): void {
    this.calendars.set(calendar.id, {
      color: "#FF2968FF",
      writable: true,
      components: ["VEVENT"],
      ...calendar,
      resources: new Map(),
      ctag: 1,
      log: [],
      oldestToken: 0,
    });
  }

  /** A change made "in Apple Calendar": returns the new etag. */
  putEvent(calendarId: string, name: string, ics: string): string {
    const calendar = this.collection(calendarId);
    const etag = `"e${this.nextEtag++}"`;
    calendar.resources.set(name, { ics, etag });
    this.changed(calendar, name);
    return etag;
  }

  removeEvent(calendarId: string, name: string): void {
    const calendar = this.collection(calendarId);
    calendar.resources.delete(name);
    this.changed(calendar, name);
  }

  event(calendarId: string, name: string): Stored | undefined {
    return this.collection(calendarId).resources.get(name);
  }

  /** Forget every sync token issued so far, so the next sync must start over. */
  expireTokens(): void {
    for (const calendar of this.calendars.values()) {
      calendar.oldestToken = this.token + 1;
    }
  }

  readonly fetch = async (request: Request): Promise<Response> => {
    const url = new URL(request.url);
    this.requests.push(`${request.method} ${url.host}${url.pathname}`);
    if (
      request.headers.get("authorization") !== `Basic ${btoa(`${this.username}:${this.password}`)}`
    ) {
      return new Response("Unauthorized", {
        status: 401,
        headers: { "www-authenticate": 'Basic realm="iCloud"' },
      });
    }
    const body = await request.text();
    return this.route(request.method, url, body, request.headers);
  };

  private route(method: string, url: URL, body: string, headers: Headers): Response {
    if (method === "PROPFIND" && (url.pathname === "/" || url.pathname === PRINCIPAL)) {
      return this.discovery(url);
    }
    if (url.host === DATA_HOST && url.pathname.startsWith(HOME)) {
      return this.home(method, url, body, headers);
    }
    return new Response("Not found", { status: 404 });
  }

  /** The home lists its calendars; a calendar answers REPORTs; an event takes PUT and DELETE. */
  private home(method: string, url: URL, body: string, headers: Headers): Response {
    const [calendarId, name] = url.pathname.slice(HOME.length).split("/");
    if (method === "PROPFIND" && !calendarId) {
      return this.listHome();
    }
    const calendar = this.calendars.get(calendarId ?? "");
    if (calendar && method === "REPORT") {
      return this.report(calendar, url, body);
    }
    if (calendar && name && (method === "PUT" || method === "DELETE")) {
      return this.write(calendar, method, name, body, headers);
    }
    return new Response("Not found", { status: 404 });
  }

  /** "/" names the principal (or redirects first), and the principal names the home. */
  private discovery(url: URL): Response {
    if (url.pathname === PRINCIPAL) {
      const home = `<c:calendar-home-set><d:href>${this.homeUrl}</d:href></c:calendar-home-set>`;
      return multistatus([propResponse(PRINCIPAL, home)]);
    }
    if (this.rootRedirect && url.host === DISCOVERY_HOST) {
      return new Response(null, { status: 301, headers: { location: this.rootRedirect } });
    }
    const principal = `<d:current-user-principal><d:href>${PRINCIPAL}</d:href></d:current-user-principal>`;
    return multistatus([propResponse("/", principal)]);
  }

  private listHome(): Response {
    const entries = [propResponse(HOME, "<d:resourcetype><d:collection/></d:resourcetype>")];
    // An inbox, like iCloud's scheduling inbox: a collection that isn't a calendar.
    entries.push(
      propResponse(
        `${HOME}inbox/`,
        "<d:resourcetype><d:collection/><c:schedule-inbox/></d:resourcetype>",
      ),
    );
    for (const calendar of this.calendars.values()) {
      const privileges = calendar.writable
        ? "<d:privilege><d:read/></d:privilege><d:privilege><d:write/></d:privilege>"
        : "<d:privilege><d:read/></d:privilege>";
      const components = calendar.components.map((name) => `<c:comp name="${name}"/>`).join("");
      entries.push(
        propResponse(
          `${HOME}${calendar.id}/`,
          `<d:displayname>${escapeXml(calendar.displayName)}</d:displayname>` +
            "<d:resourcetype><d:collection/><c:calendar/></d:resourcetype>" +
            `<a:calendar-color>${calendar.color}</a:calendar-color>` +
            `<cs:getctag>ctag-${calendar.ctag}</cs:getctag>` +
            `<d:sync-token>${this.tokenUrl(this.token)}</d:sync-token>` +
            `<c:supported-calendar-component-set>${components}</c:supported-calendar-component-set>` +
            `<d:current-user-privilege-set>${privileges}</d:current-user-privilege-set>`,
        ),
      );
    }
    return multistatus(entries);
  }

  private report(calendar: Collection, url: URL, body: string): Response {
    if (body.includes("sync-collection")) {
      return this.syncReport(calendar, url, body);
    }
    if (body.includes("calendar-multiget")) {
      const hrefs = [...body.matchAll(/<(?:\w+:)?href>([^<]+)<\/(?:\w+:)?href>/g)].map(
        (m) => m[1] ?? "",
      );
      const entries = hrefs.flatMap((href) => {
        const stored = calendar.resources.get(href.split("/").at(-1) ?? "");
        return stored
          ? [
              propResponse(
                href,
                `<d:getetag>${stored.etag}</d:getetag><c:calendar-data>${escapeXml(stored.ics)}</c:calendar-data>`,
              ),
            ]
          : [];
      });
      return multistatus(entries);
    }
    if (body.includes("calendar-query")) {
      return multistatus(
        [...calendar.resources].map(([name, stored]) =>
          propResponse(`${url.pathname}${name}`, `<d:getetag>${stored.etag}</d:getetag>`),
        ),
      );
    }
    return new Response("Unsupported report", { status: 400 });
  }

  private syncReport(calendar: Collection, url: URL, body: string): Response {
    const sent = /<(?:\w+:)?sync-token>([^<]*)</.exec(body)?.[1] ?? "";
    const since = sent ? Number(sent.split("/").at(-1)) : 0;
    if (sent && (Number.isNaN(since) || since < calendar.oldestToken)) {
      return new Response(
        '<?xml version="1.0"?><d:error xmlns:d="DAV:"><d:valid-sync-token/></d:error>',
        { status: 403, headers: { "content-type": "application/xml" } },
      );
    }
    const names = since
      ? new Set(calendar.log.filter((change) => change.token > since).map((change) => change.name))
      : new Set(calendar.resources.keys());
    const entries = [...names].map((name) => {
      const stored = calendar.resources.get(name);
      const href = `${url.pathname}${name}`;
      return stored
        ? propResponse(href, `<d:getetag>${stored.etag}</d:getetag>`)
        : `<d:response><d:href>${href}</d:href><d:status>HTTP/1.1 404 Not Found</d:status></d:response>`;
    });
    return multistatus(entries, `<d:sync-token>${this.tokenUrl(this.token)}</d:sync-token>`);
  }

  private write(
    calendar: Collection,
    method: "PUT" | "DELETE",
    name: string,
    body: string,
    headers: Headers,
  ): Response {
    if (!calendar.writable) {
      return new Response("Forbidden", { status: 403 });
    }
    const stored = calendar.resources.get(name);
    const ifMatch = headers.get("if-match");
    if ((headers.get("if-none-match") === "*" && stored) || (ifMatch && ifMatch !== stored?.etag)) {
      return new Response("Precondition failed", { status: 412 });
    }
    if (method === "DELETE") {
      if (!stored) {
        return new Response("Not found", { status: 404 });
      }
      this.removeEvent(calendar.id, name);
      return new Response(null, { status: 204 });
    }
    const etag = this.putEvent(calendar.id, name, body);
    return new Response(null, { status: stored ? 204 : 201, headers: { etag } });
  }

  private collection(id: string): Collection {
    const calendar = this.calendars.get(id);
    if (!calendar) {
      throw new Error(`No fake calendar ${id}`);
    }
    return calendar;
  }

  private changed(calendar: Collection, name: string): void {
    this.token++;
    calendar.ctag++;
    calendar.log.push({ token: this.token, name });
  }

  private tokenUrl(token: number): string {
    return `https://${DATA_HOST}/sync/${token}`;
  }
}

function propResponse(href: string, props: string): string {
  return `<d:response><d:href>${href}</d:href><d:propstat><d:prop>${props}</d:prop><d:status>HTTP/1.1 200 OK</d:status></d:propstat></d:response>`;
}

function multistatus(entries: string[], extra = ""): Response {
  const xml =
    '<?xml version="1.0" encoding="UTF-8"?>' +
    '<d:multistatus xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/">' +
    `${entries.join("")}${extra}</d:multistatus>`;
  return new Response(xml, {
    status: 207,
    headers: { "content-type": "application/xml; charset=utf-8" },
  });
}

function escapeXml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}
