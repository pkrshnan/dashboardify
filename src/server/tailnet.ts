// Signing in through Tailscale instead of a token. Tailscale Serve proxies requests from your
// tailnet to this server and adds a `Tailscale-User-Login` header naming who sent them (it drops
// any such header the client sent). That header proves who you are only if the request really
// came through Tailscale Serve, so it is trusted only from the proxy's address. Other containers
// on the Docker network reach the server from their own addresses and still need a token.

import { readFileSync } from "node:fs";

export interface TailnetAuth {
  /** The address Tailscale Serve's requests come from, as this server sees it. */
  proxy: string;
  /** Tailnet logins allowed in, e.g. "pkrshnan@github". */
  users: Set<string>;
}

export const LOGIN_HEADER = "tailscale-user-login";

/**
 * Settings' tailnet proxy (an IP, or "gateway") and allowed logins (comma-separated). Both are
 * needed; without them only tokens work.
 */
export function parseTailnet(
  proxy: string | undefined,
  users: string | undefined,
  gateway: () => string | null = defaultGateway,
): TailnetAuth | null {
  const logins = new Set(
    (users ?? "")
      .split(",")
      .map((u) => u.trim())
      .filter((u) => u !== ""),
  );
  if (!proxy || logins.size === 0) {
    return null;
  }
  const address = proxy === "gateway" ? gateway() : proxy;
  if (!address) {
    throw new Error("TAILSCALE_PROXY=gateway, but there is no default route to read it from");
  }
  return { proxy: address, users: logins };
}

/** The logged-in tailnet user for a request, or undefined when it isn't from the proxy. */
export function tailnetUser(
  auth: TailnetAuth | null,
  peer: string | undefined,
  login: string | undefined,
): string | undefined {
  if (!(auth && peer && login)) {
    return undefined;
  }
  if (unmapped(peer) !== auth.proxy || !auth.users.has(login)) {
    return undefined;
  }
  return login;
}

/** "::ffff:172.18.0.1" -> "172.18.0.1" */
function unmapped(address: string): string {
  return address.startsWith("::ffff:") ? address.slice("::ffff:".length) : address;
}

/**
 * The default gateway from /proc/net/route. In a Docker container that is the bridge's address,
 * which is where requests to a port published on the host appear to come from.
 */
export function defaultGateway(routes = readRoutes()): string | null {
  for (const line of routes.split("\n").slice(1)) {
    const [, destination, gateway] = line.trim().split(/\s+/);
    if (destination === "00000000" && gateway) {
      return hexToIp(gateway);
    }
  }
  return null;
}

function readRoutes(): string {
  try {
    return readFileSync("/proc/net/route", "utf8");
  } catch {
    return "";
  }
}

/** /proc/net/route stores IPv4 addresses as little-endian hex. */
function hexToIp(hex: string): string {
  const bytes = hex.match(/../g) ?? [];
  return bytes
    .map((b) => Number.parseInt(b, 16))
    .reverse()
    .join(".");
}
