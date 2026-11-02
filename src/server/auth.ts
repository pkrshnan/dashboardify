import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

/** Hono context type for authenticated routes: the matched device name is available. */
// biome-ignore lint/style/useNamingConvention: `Variables` is the key Hono expects.
export type AuthEnv = { Variables: { device: string } };

/**
 * Accept `Authorization: Bearer <token>` for any configured device, and set the device name
 * on the context.
 */
export function bearerAuth(tokens: Map<string, string>): MiddlewareHandler<AuthEnv> {
  const known = [...tokens].map(([device, token]) => ({ device, token: Buffer.from(token) }));

  return async (c, next) => {
    const device = matchDevice(known, bearerToken(c.req.header("authorization")));
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
