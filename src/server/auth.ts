import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import type { DeviceMatcher } from "../settings/devices";
import { LOGIN_HEADER, type TailnetAuth, tailnetUser } from "./tailnet";

/** Hono context type for authenticated routes: the matched device id is available. */
// biome-ignore lint/style/useNamingConvention: `Variables` is the key Hono expects.
export type AuthEnv = { Variables: { device: string } };

/**
 * Accept `Authorization: Bearer <token>` for any device in Settings, or a tailnet user signed in
 * through Tailscale Serve (see tailnet.ts), and set the device id on the context.
 */
export function bearerAuth(
  devices: DeviceMatcher,
  tailnet: TailnetAuth | null = null,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const login = tailnetUser(tailnet, peerAddress(c), c.req.header(LOGIN_HEADER));
    const device =
      devices.match(bearerToken(c.req.header("authorization"))) ??
      (login ? `tailnet:${login}` : undefined);
    if (!device) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("device", device);
    await next();
  };
}

function bearerToken(header: string | undefined): string {
  const prefix = "Bearer ";
  return header?.startsWith(prefix) ? header.slice(prefix.length) : "";
}

/** The connecting address, or undefined when the server doesn't say (as in tests without one). */
function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}
