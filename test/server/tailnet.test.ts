import { describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";
import { defaultGateway, parseTailnet, tailnetUser } from "../../src/server/tailnet";

const PROXY = "172.18.0.1";
const auth = { proxy: PROXY, users: new Set(["pkrshnan@github"]) };

describe("parseTailnet", () => {
  test("needs both the proxy and at least one user", () => {
    expect(parseTailnet(undefined, "a@github")).toBeNull();
    expect(parseTailnet("172.18.0.1", " , ")).toBeNull();
    expect(parseTailnet("172.18.0.1", "a@github, b@github")).toEqual({
      proxy: "172.18.0.1",
      users: new Set(["a@github", "b@github"]),
    });
  });

  test("gateway means the container's default gateway", () => {
    expect(parseTailnet("gateway", "a@github", () => "172.30.0.1")?.proxy).toBe("172.30.0.1");
    expect(() => parseTailnet("gateway", "a@github", () => null)).toThrow("no default route");
  });

  test("reads the default gateway from /proc/net/route", () => {
    const routes = [
      "Iface\tDestination\tGateway \tFlags\tRefCnt\tUse\tMetric\tMask",
      "eth0\t00000000\t010012AC\t0003\t0\t0\t0\t00000000",
      "eth0\t000012AC\t00000000\t0001\t0\t0\t0\t0000FFFF",
    ].join("\n");
    expect(defaultGateway(routes)).toBe("172.18.0.1");
    expect(defaultGateway("")).toBeNull();
  });
});

describe("tailnetUser", () => {
  test("trusts the login header only from the proxy, and only for listed users", () => {
    expect(tailnetUser(auth, PROXY, "pkrshnan@github")).toBe("pkrshnan@github");
    expect(tailnetUser(auth, `::ffff:${PROXY}`, "pkrshnan@github")).toBe("pkrshnan@github");
    expect(tailnetUser(auth, "172.18.0.5", "pkrshnan@github")).toBeUndefined();
    expect(tailnetUser(auth, PROXY, "someone@github")).toBeUndefined();
    expect(tailnetUser(auth, PROXY, undefined)).toBeUndefined();
    expect(tailnetUser(null, PROXY, "pkrshnan@github")).toBeUndefined();
  });
});

describe("API sign-in through Tailscale", () => {
  async function request(peer: string, login?: string): Promise<number> {
    const dir = await mkdtemp(join(tmpdir(), "tailnet-"));
    const config: Config = {
      vaultPath: dir,
      port: 0,
      timeZone: "Europe/London",
      healthRawPath: join(dir, "raw"),
      healthDerivedPath: join(dir, "derived"),
      tasksInbox: "Inbox.md",
      tokens: new Map([["healthstrap", "healthstrap-token-0123"]]),
      tailnet: auth,
    };
    // Bun passes its server to fetch; requestIP is how Hono reads the peer address.
    const server = { requestIP: () => ({ address: peer, family: "IPv4", port: 50000 }) };
    const headers: Record<string, string> = login ? { "tailscale-user-login": login } : {};
    const res = await createApp(config).request("/api/tasks", { headers }, server);
    await rm(dir, { recursive: true, force: true });
    return res.status;
  }

  test("lets a listed tailnet user in through the proxy, without a token", async () => {
    expect(await request(PROXY, "pkrshnan@github")).toBe(200);
  });

  test("refuses the same header from another container", async () => {
    expect(await request("172.18.0.7", "pkrshnan@github")).toBe(401);
  });

  test("refuses the proxy without a login", async () => {
    expect(await request(PROXY)).toBe(401);
  });
});
