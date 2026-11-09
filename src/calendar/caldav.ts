// A small CalDAV client for iCloud: discovery, listing calendars, incremental sync, and
// single-event writes with preconditions. It only talks `fetch`, so tests hand it a fake server.
// Basic auth is sent only over HTTPS and only to hosts under the account's domain, and redirects
// are followed by hand so one can't carry the password anywhere else.

import { XMLParser } from "fast-xml-parser";

export interface CalDavAccount {
  /** Where discovery starts, e.g. "https://caldav.icloud.com/". */
  serverUrl: string;
  username: string;
  password: string;
  /** Hosts the password may go to, as domain suffixes, e.g. ["icloud.com"]. */
  allowedDomains: string[];
}

export interface CalDavCalendar {
  /** Absolute URL of the collection. */
  url: string;
  displayName: string;
  color?: string;
  ctag?: string;
  syncToken?: string;
  /** From current-user-privilege-set: false for calendars shared with you as view-only. */
  writable: boolean;
}

export interface ResourceRef {
  /** Absolute URL of the .ics resource. */
  url: string;
  etag: string;
}

export interface Resource extends ResourceRef {
  ics: string;
}

export type SyncResult =
  | { kind: "changes"; syncToken: string; changed: ResourceRef[]; deleted: string[] }
  /** The server forgot the token: list everything with `listResources` and compare etags. */
  | { kind: "token-expired" };

export class CalDavError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** 401: the app-specific password was revoked or is wrong. */
export class Unauthorized extends CalDavError {}

/** 412: the resource changed (If-Match) or already exists (If-None-Match). */
export class PreconditionFailed extends CalDavError {}

/** A redirect to plain HTTP or to a host outside the account's domains. */
export class UnsafeRedirect extends CalDavError {}

type Fetch = (request: Request) => Promise<Response>;

const MAX_REDIRECTS = 5;

const xml = new XMLParser({
  removeNSPrefix: true,
  ignoreAttributes: false,
  attributeNamePrefix: "@",
  parseTagValue: false,
  trimValues: false,
  isArray: (name) => ["response", "propstat", "privilege", "comp", "href"].includes(name),
});

const NAMESPACES =
  'xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:cs="http://calendarserver.org/ns/" xmlns:a="http://apple.com/ns/ical/"';

export class CalDavClient {
  constructor(
    private readonly account: CalDavAccount,
    private readonly fetch: Fetch = (request) => globalThis.fetch(request),
  ) {}

  /** The calendar home: current-user-principal, then calendar-home-set. */
  async discover(): Promise<string> {
    const root = await this.propfind(this.account.serverUrl, 0, "<d:current-user-principal/>");
    const principal = firstHref(root.responses[0]?.prop["current-user-principal"]);
    if (!principal) {
      throw new CalDavError(0, "No current-user-principal in the server's answer");
    }
    const principalUrl = new URL(principal, root.url).href;
    const found = await this.propfind(principalUrl, 0, "<c:calendar-home-set/>");
    const home = firstHref(found.responses[0]?.prop["calendar-home-set"]);
    if (!home) {
      throw new CalDavError(0, "No calendar-home-set in the server's answer");
    }
    return new URL(home, found.url).href;
  }

  /** Event calendars in the home. Task lists, inboxes and other collections are skipped. */
  async listCalendars(homeUrl: string): Promise<CalDavCalendar[]> {
    const found = await this.propfind(
      homeUrl,
      1,
      "<d:displayname/><d:resourcetype/><a:calendar-color/><cs:getctag/><d:sync-token/>" +
        "<c:supported-calendar-component-set/><d:current-user-privilege-set/>",
    );
    return found.responses.filter(isEventCalendar).map((response) => ({
      url: new URL(response.href, found.url).href,
      displayName: text(response.prop.displayname) || "Calendar",
      color: text(response.prop["calendar-color"]) || undefined,
      ctag: text(response.prop.getctag) || undefined,
      syncToken: text(response.prop["sync-token"]) || undefined,
      writable: canWrite(response.prop["current-user-privilege-set"]),
    }));
  }

  /** What changed since `syncToken` (or everything, with none). */
  async sync(calendarUrl: string, syncToken: string | undefined): Promise<SyncResult> {
    const body =
      `<d:sync-collection ${NAMESPACES}><d:sync-token>${escapeXml(syncToken ?? "")}</d:sync-token>` +
      "<d:sync-level>1</d:sync-level><d:prop><d:getetag/></d:prop></d:sync-collection>";
    const response = await this.send("REPORT", calendarUrl, body, { depth: "1" }, [403, 409]);
    const answer = await response.text();
    if (response.status === 403 || response.status === 409) {
      if (answer.includes("valid-sync-token")) {
        return { kind: "token-expired" };
      }
      throw new CalDavError(response.status, `REPORT failed: ${response.status}`);
    }
    const parsed = parseMultistatus(answer, response.url);
    const changed: ResourceRef[] = [];
    const deleted: string[] = [];
    for (const entry of parsed.responses.filter((r) => r.href.endsWith(".ics"))) {
      const url = new URL(entry.href, parsed.url).href;
      if (entry.status.includes(" 404")) {
        deleted.push(url);
      } else {
        changed.push({ url, etag: text(entry.prop.getetag) });
      }
    }
    return { kind: "changes", syncToken: parsed.syncToken ?? "", changed, deleted };
  }

  /** Every event resource's URL and etag, for a full comparison when sync can't be used. */
  async listResources(calendarUrl: string): Promise<ResourceRef[]> {
    const body =
      `<c:calendar-query ${NAMESPACES}><d:prop><d:getetag/></d:prop>` +
      '<c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"/></c:comp-filter></c:filter></c:calendar-query>';
    const response = await this.send("REPORT", calendarUrl, body, { depth: "1" });
    const parsed = parseMultistatus(await response.text(), response.url);
    return parsed.responses
      .filter((entry) => entry.href.endsWith(".ics"))
      .map((entry) => ({
        url: new URL(entry.href, parsed.url).href,
        etag: text(entry.prop.getetag),
      }));
  }

  /** The iCalendar text of each resource, in one request. */
  async fetchResources(calendarUrl: string, urls: string[]): Promise<Resource[]> {
    if (urls.length === 0) {
      return [];
    }
    const hrefs = urls
      .map((url) => `<d:href>${escapeXml(new URL(url).pathname)}</d:href>`)
      .join("");
    const body = `<c:calendar-multiget ${NAMESPACES}><d:prop><d:getetag/><c:calendar-data/></d:prop>${hrefs}</c:calendar-multiget>`;
    const response = await this.send("REPORT", calendarUrl, body, { depth: "1" });
    const parsed = parseMultistatus(await response.text(), response.url);
    return parsed.responses
      .filter((entry) => text(entry.prop["calendar-data"]))
      .map((entry) => ({
        url: new URL(entry.href, parsed.url).href,
        etag: text(entry.prop.getetag),
        ics: text(entry.prop["calendar-data"]),
      }));
  }

  /**
   * Writes one resource. With `etag` it only replaces that version; without, it only creates,
   * so a retried create fails with PreconditionFailed instead of making a second copy.
   */
  async put(url: string, ics: string, etag?: string): Promise<{ etag?: string }> {
    const condition: Record<string, string> = etag
      ? { "if-match": etag }
      : { "if-none-match": "*" };
    const response = await this.send("PUT", url, ics, {
      ...condition,
      "content-type": "text/calendar; charset=utf-8",
    });
    return { etag: response.headers.get("etag") ?? undefined };
  }

  async delete(url: string, etag: string): Promise<void> {
    await this.send("DELETE", url, undefined, { "if-match": etag });
  }

  private async propfind(url: string, depth: 0 | 1, props: string) {
    const body = `<?xml version="1.0" encoding="utf-8"?><d:propfind ${NAMESPACES}><d:prop>${props}</d:prop></d:propfind>`;
    const response = await this.send("PROPFIND", url, body, { depth: String(depth) });
    return parseMultistatus(await response.text(), response.url);
  }

  /** One request, following redirects only to safe hosts. `allowed` statuses are returned. */
  private async send(
    method: string,
    url: string,
    body: string | undefined,
    headers: Record<string, string>,
    allowed: number[] = [],
  ): Promise<Response> {
    let target = url;
    for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
      this.checkHost(target);
      const response = await this.fetch(
        new Request(target, {
          method,
          body,
          redirect: "manual",
          headers: {
            "content-type": "application/xml; charset=utf-8",
            ...headers,
            authorization: `Basic ${btoa(`${this.account.username}:${this.account.password}`)}`,
          },
        }),
      );
      const location = response.headers.get("location");
      if (response.status >= 300 && response.status < 400 && location) {
        target = new URL(location, target).href;
        continue;
      }
      return withUrl(checkStatus(response, method, allowed), target);
    }
    throw new CalDavError(0, `More than ${MAX_REDIRECTS} redirects`);
  }

  private checkHost(url: string): void {
    const { protocol, hostname } = new URL(url);
    const allowed = this.account.allowedDomains.some(
      (domain) => hostname === domain || hostname.endsWith(`.${domain}`),
    );
    if (protocol !== "https:" || !allowed) {
      throw new UnsafeRedirect(0, `Refusing to send the password to ${protocol}//${hostname}`);
    }
  }
}

function checkStatus(response: Response, method: string, allowed: number[]): Response {
  if (response.ok || allowed.includes(response.status)) {
    return response;
  }
  const message = `${method} failed: ${response.status}`;
  if (response.status === 401) {
    throw new Unauthorized(401, "iCloud didn't accept the Apple ID and app-specific password");
  }
  if (response.status === 412) {
    throw new PreconditionFailed(412, message);
  }
  throw new CalDavError(response.status, message);
}

/** A Response's `url` is read-only and empty for fetch handlers in tests; carry ours. */
function withUrl(response: Response, url: string): Response & { url: string } {
  Object.defineProperty(response, "url", { value: url });
  return response;
}

interface Entry {
  href: string;
  /** The props of the 200 propstat (or of the response, for sync results). */
  prop: Record<string, unknown>;
  /** The response-level status, set for deletions in sync results. */
  status: string;
}

function parseMultistatus(body: string, url: string) {
  const root = xml.parse(body).multistatus ?? {};
  const responses: Entry[] = (root.response ?? []).map(
    (response: {
      href?: string[];
      propstat?: { prop?: object; status?: string }[];
      status?: string;
    }) => {
      const ok = (response.propstat ?? []).find((p) => String(p.status ?? "").includes(" 200"));
      return {
        href: text(response.href?.[0]),
        prop: (ok?.prop ?? {}) as Record<string, unknown>,
        status: text(response.status),
      };
    },
  );
  return { url, responses, syncToken: text(root["sync-token"]) || undefined };
}

function isEventCalendar(entry: Entry): boolean {
  const type = entry.prop.resourcetype as Record<string, unknown> | undefined;
  if (!(type && "calendar" in type)) {
    return false;
  }
  const set = entry.prop["supported-calendar-component-set"] as { comp?: { "@name"?: string }[] };
  const components = set?.comp?.map((comp) => comp["@name"]) ?? [];
  // A server that doesn't say is assumed to hold events.
  return components.length === 0 || components.includes("VEVENT");
}

function canWrite(set: unknown): boolean {
  const privileges =
    (set as { privilege?: Record<string, unknown>[] } | undefined)?.privilege ?? [];
  return privileges.some((p) => "write" in p || "write-content" in p || "all" in p || "bind" in p);
}

function firstHref(value: unknown): string | undefined {
  const hrefs = (value as { href?: string[] } | undefined)?.href;
  return hrefs?.[0] ? text(hrefs[0]) : undefined;
}

/** An element's text, whether the parser gave a string or an object with #text. */
function text(value: unknown): string {
  if (typeof value === "string") {
    return value.trim();
  }
  if (value && typeof value === "object" && "#text" in value) {
    return String((value as { "#text": unknown })["#text"]).trim();
  }
  return "";
}

function escapeXml(value: string): string {
  return value.replace(/[<>&'"]/g, (c) => `&#${c.charCodeAt(0)};`);
}
