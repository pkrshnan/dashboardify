import { timingSafeEqual } from "node:crypto";
import type { MiddlewareHandler } from "hono";

export type AuthEnv = { Variables: { device: string } };

/** Accept `Authorization: Bearer <token>` for any configured device; the device name is set on the context. */
export function bearerAuth(tokens: Map<string, string>): MiddlewareHandler<AuthEnv> {
  const entries = [...tokens.entries()].map(([device, token]) => [device, Buffer.from(token)] as const);
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    // Compare against every token so timing doesn't reveal which device matched.
    let device: string | undefined;
    for (const [name, token] of entries) {
      if (token.length === given.length && timingSafeEqual(token, given)) device = name;
    }
    if (!device) return c.json({ error: "unauthorized" }, 401);
    c.set("device", device);
    await next();
  };
}
