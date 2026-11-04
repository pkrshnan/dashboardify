import { timingSafeEqual } from "node:crypto";
import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import { LOGIN_HEADER, type TailnetAuth, tailnetUser } from "./tailnet";

/** Hono context type for authenticated routes: the matched device name is available. */
// biome-ignore lint/style/useNamingConvention: `Variables` is the key Hono expects.
export type AuthEnv = { Variables: { device: string } };

/**
 * Accept `Authorization: Bearer <token>` for any configured device, or a tailnet user signed in
 * through Tailscale Serve (see tailnet.ts), and set the device name on the context.
 */
export function bearerAuth(
  tokens: Map<string, string>,
  tailnet: TailnetAuth | null = null,
): MiddlewareHandler<AuthEnv> {
  const known = [...tokens].map(([device, token]) => ({ device, token: Buffer.from(token) }));

  return async (c, next) => {
    const login = tailnetUser(tailnet, peerAddress(c), c.req.header(LOGIN_HEADER));
    const device =
      matchDevice(known, bearerToken(c.req.header("authorization"))) ??
      (login ? `tailnet:${login}` : undefined);
    if (!device) {
      return c.json({ error: "unauthorized" }, 401);
    }
    c.set("device", device);
    await next();
  };
}

function bearerToken(header: string | undefined): Buffer {
  const prefix = "Bearer ";
  return Buffer.from(header?.startsWith(prefix) ? header.slice(prefix.length) : "");
}

/** Compare against every token, so the time taken doesn't reveal which device matched. */
function matchDevice(
  known: { device: string; token: Buffer }[],
  given: Buffer,
): string | undefined {
  let match: string | undefined;
  for (const { device, token } of known) {
    const isEqual = token.length === given.length && timingSafeEqual(token, given);
    if (isEqual) {
      match = device;
    }
  }
  return match;
}

/** The connecting address, or undefined when the server doesn't say (as in tests without one). */
function peerAddress(c: Context): string | undefined {
  try {
    return getConnInfo(c).remote.address;
  } catch {
    return undefined;
  }
}
