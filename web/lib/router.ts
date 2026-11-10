// Addresses for the web app, kept in the hash so the server needs no routes and the PWA and
// Shortcuts' "Open URL" can link to any page: `#/<page>/<rest>?<state>`. The page is the path;
// state a page keeps across reloads (Day or Week, the Activity range) is the query. Pure: the
// hook that follows the address bar is in use-route.ts.

export interface Address {
  /** "/", "/activity", "/settings/calendars": always starts with "/", never ends with one. */
  path: string;
  query: Record<string, string>;
}

/** Hashes from before addresses, rewritten so bookmarks and home-screen icons keep working. */
const LEGACY: Record<string, string> = {
  "#home": "#/",
  "#activity": "#/activity",
  "#settings": "#/settings",
};

/** "#/settings/devices?x=1" → { path: "/settings/devices", query: { x: "1" } }. */
export function parseAddress(hash: string): Address {
  const [rawPath = "", rawQuery = ""] = hash.replace(/^#/, "").split("?", 2);
  const parts = rawPath.split("/").filter((part) => part !== "");
  const query: Record<string, string> = {};
  for (const [key, value] of new URLSearchParams(rawQuery)) {
    query[key] = value;
  }
  return { path: `/${parts.map(decodeURIComponent).join("/")}`, query };
}

/** The hash for an address; empty query values are left out. */
export function formatAddress(address: Address): string {
  const path = address.path
    .split("/")
    .filter((part) => part !== "")
    .map(encodeURIComponent)
    .join("/");
  const entries = Object.entries(address.query).filter(([, value]) => value !== "");
  const query = entries.length > 0 ? `?${new URLSearchParams(entries)}` : "";
  return `#/${path}${query}`;
}

/** The link to a path, such as href("/activity") → "#/activity". */
export function href(path: string, query: Record<string, string> = {}): string {
  return formatAddress({ path, query });
}

/**
 * The address a hash should become, or null when it is already one. Old hashes ("#activity",
 * "#settings/devices") are mapped; an empty hash is Today. A sign-in link ("#token=…") is not an
 * address and is left to the sign-in code.
 */
export function upgradeHash(hash: string): string | null {
  if (hash.startsWith("#/") || hash.startsWith("#token=")) {
    return null;
  }
  if (hash.startsWith("#settings/")) {
    return `#/${hash.slice(1)}`;
  }
  return LEGACY[hash] ?? "#/";
}

/**
 * The parameters of `path` matched against a pattern such as "/settings/:section?", or null.
 * `:name` matches one segment; a trailing `?` makes it optional.
 */
export function matchPath(pattern: string, path: string): Record<string, string> | null {
  const want = pattern.split("/").filter((part) => part !== "");
  const have = path.split("/").filter((part) => part !== "");
  if (have.length > want.length) {
    return null;
  }
  const params: Record<string, string> = {};
  for (const [i, segment] of want.entries()) {
    if (!matchSegment(segment, have[i], params)) {
      return null;
    }
  }
  return params;
}

/** Whether one path segment fits the pattern's; a `:name` adds its value to `params`. */
function matchSegment(
  segment: string,
  value: string | undefined,
  params: Record<string, string>,
): boolean {
  if (!segment.startsWith(":")) {
    return value === segment;
  }
  if (value === undefined) {
    return segment.endsWith("?");
  }
  params[segment.slice(1).replace(/\?$/, "")] = value;
  return true;
}
