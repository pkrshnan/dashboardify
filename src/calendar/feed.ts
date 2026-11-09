// Fetches a calendar link (an ICS URL, such as Outlook's "Publish calendar" link). The URL is a
// secret, since anyone with it can read the calendar: it only goes over HTTPS, every redirect must
// stay on HTTPS, and errors and logs name the host, never the path or query.

const MAX_BYTES = 10 * 1024 * 1024;
const MAX_REDIRECTS = 5;
const TIMEOUT_MS = 30_000;

export type FeedResult =
  | { kind: "not-modified" }
  | { kind: "ok"; ics: string; etag?: string; lastModified?: string };

/** The link stopped working (401, 403, 404, 410): it was unpublished or changed. */
export class FeedGone extends Error {}

/** Anything else: a bad URL, a network failure, too big, not iCalendar. */
export class FeedError extends Error {}

type Fetch = (request: Request) => Promise<Response>;

/** "webcal://…" → "https://…". Plain http and other schemes are refused. */
export function feedUrl(input: string): URL {
  let url: URL;
  try {
    url = new URL(input.trim().replace(/^webcals?:\/\//i, "https://"));
  } catch {
    throw new FeedError("That isn't a link. Paste the whole https:// or webcal:// address.");
  }
  if (url.protocol !== "https:") {
    throw new FeedError("Calendar links must use https:// (or webcal://).");
  }
  return url;
}

export async function fetchFeed(
  input: string,
  cached: { etag?: string; lastModified?: string } = {},
  fetch: Fetch = (request) => globalThis.fetch(request),
): Promise<FeedResult> {
  let url = feedUrl(input);
  for (let hop = 0; hop <= MAX_REDIRECTS; hop++) {
    const response = await send(url, cached, fetch);
    const location = response.headers.get("location");
    if (response.status >= 300 && response.status < 400 && location) {
      url = feedUrl(new URL(location, url).href);
      continue;
    }
    return read(response, url);
  }
  throw new FeedError(`${url.host} redirected too many times.`);
}

async function send(url: URL, cached: { etag?: string; lastModified?: string }, fetch: Fetch) {
  const headers: Record<string, string> = { accept: "text/calendar, */*;q=0.5" };
  if (cached.etag) {
    headers["if-none-match"] = cached.etag;
  }
  if (cached.lastModified) {
    headers["if-modified-since"] = cached.lastModified;
  }
  try {
    return await fetch(
      new Request(url, { headers, redirect: "manual", signal: AbortSignal.timeout(TIMEOUT_MS) }),
    );
  } catch {
    throw new FeedError(`Couldn't reach ${url.host}.`);
  }
}

async function read(response: Response, url: URL): Promise<FeedResult> {
  if (response.status === 304) {
    return { kind: "not-modified" };
  }
  if ([401, 403, 404, 410].includes(response.status)) {
    throw new FeedGone(`${url.host} says the link no longer works (${response.status}).`);
  }
  if (!response.ok) {
    throw new FeedError(`${url.host} answered ${response.status}.`);
  }
  const ics = await readCapped(response, url);
  if (!/^\s*BEGIN:VCALENDAR/i.test(ics)) {
    throw new FeedError(
      "That link isn't a calendar feed. In Outlook, copy the ICS link, not the HTML one.",
    );
  }
  return {
    kind: "ok",
    ics,
    etag: response.headers.get("etag") ?? undefined,
    lastModified: response.headers.get("last-modified") ?? undefined,
  };
}

/** Reads at most 10 MB, so a huge or endless response can't fill memory. */
async function readCapped(response: Response, url: URL): Promise<string> {
  const reader = response.body?.getReader();
  if (!reader) {
    return "";
  }
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (let next = await reader.read(); !next.done; next = await reader.read()) {
    size += next.value.length;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError(`The calendar at ${url.host} is over 10 MB.`);
    }
    chunks.push(next.value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/** The feed's own name (X-WR-CALNAME), to suggest in Settings. */
export function feedName(ics: string): string | undefined {
  return /^X-WR-CALNAME:(.+)$/im.exec(ics)?.[1]?.trim() || undefined;
}
