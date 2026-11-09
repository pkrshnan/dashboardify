import type { Context, MiddlewareHandler } from "hono";
import { getConnInfo } from "hono/bun";
import type { DeviceMatcher } from "../settings/devices";
import type { SetupCode } from "../settings/setup-code";
import { withDevice } from "./request-context";
import { LOGIN_HEADER, type TailnetAuth, tailnetUser } from "./tailnet";

/** Hono context type for authenticated routes: the matched device id is available. */
// biome-ignore lint/style/useNamingConvention: `Variables` is the key Hono expects.
export type AuthEnv = { Variables: { device: string } };

/**
 * Accept `Authorization: Bearer <token>` for any device in Settings, or a tailnet user signed in
 * through Tailscale Serve (see tailnet.ts), and set the device id on the context. `tailnet` is
 * read on every request, so a change in Settings applies without a restart. A setup code, while
 * one is waiting, signs in only to add a device, and only once.
 */
export function bearerAuth(
  devices: DeviceMatcher,
  tailnet: () => TailnetAuth | null = () => null,
  setup?: SetupCode,
): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const token = bearerToken(c.req.header("authorization"));
    const login = tailnetUser(tailnet(), peerAddress(c), c.req.header(LOGIN_HEADER));
    const device =
      devices.match(token) ??
      (login ? `tailnet:${login}` : undefined) ??
      (setup && addsDevice(c) && setup.redeem(token) ? "setup" : undefined);
    if (!device) {
      // While a setup code is waiting, say so, so the sign-in screen can offer it.
      return c.json({ error: "unauthorized", ...(setup?.active() && { setup: true }) }, 401);
    }
    c.set("device", device);
    await withDevice(device, () => next());
  };
}

/** The one request a setup code may make: CreateDevice, over REST or Connect. */
function addsDevice(c: Context): boolean {
  const path = new URL(c.req.url).pathname;
  return (
    c.req.method === "POST" &&
    (path === "/v1/devices" || path === "/dashboardify.v1.DeviceService/CreateDevice")
  );
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
