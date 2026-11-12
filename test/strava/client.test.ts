import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { exportToml } from "../../src/settings/export";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";
import { AlreadyConnected, StravaAccounts } from "../../src/strava/account";
import {
  authorizeUrl,
  codeFrom,
  StravaAuthFailed,
  StravaClient,
  StravaUnavailable,
} from "../../src/strava/client";
import { FakeStrava } from "./fake-strava";

let dir: string;
let store: SettingsStore;
let strava: FakeStrava;
let accounts: StravaAccounts;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "strava-"));
  store = await SettingsStore.open(dir, new SecretBox(randomBytes(32)));
  strava = new FakeStrava();
  accounts = new StravaAccounts(store);
});

afterEach(async () => {
  store.close();
  await rm(dir, { recursive: true, force: true });
});

/** A client whose clock is the fake's, in milliseconds. */
function client(): StravaClient {
  return new StravaClient(accounts, strava.fetch, strava.baseUrl, () => strava.now * 1000);
}

const app = () => ({ clientId: strava.clientId, clientSecret: strava.clientSecret });

async function connect(): Promise<void> {
  const { athlete, tokens } = await client().exchange(app(), strava.code);
  accounts.create(athlete, app(), tokens);
}

describe("authorizeUrl and codeFrom", () => {
  test("asks for private activities and sends you to localhost", () => {
    const url = new URL(authorizeUrl("12345"));

    expect(url.origin + url.pathname).toBe("https://www.strava.com/oauth/authorize");
    expect(url.searchParams.get("scope")).toBe("activity:read_all");
    expect(url.searchParams.get("redirect_uri")).toBe("http://localhost/strava");
  });

  test("takes the code from the pasted address, or a bare code", () => {
    const pasted = "http://localhost/strava?state=&code=abc123&scope=read,activity:read_all";

    expect(codeFrom(pasted)).toBe("abc123");
    expect(codeFrom(" abc123\n")).toBe("abc123");
  });

  test("refuses an address without private activities, or a denial", () => {
    expect(() => codeFrom("http://localhost/strava?code=abc&scope=read,activity:read")).toThrow(
      "Allow viewing private activities",
    );
    expect(() => codeFrom("http://localhost/strava?error=access_denied")).toThrow("access_denied");
  });
});

describe("StravaClient", () => {
  test("exchange returns the athlete; the account keeps secrets sealed", async () => {
    await connect();

    expect(accounts.get()).toMatchObject({ athleteId: 777, athleteName: "Pat Runner" });
    expect(accounts.credentials()).toMatchObject({
      clientSecret: "app-secret",
      refreshToken: "refresh-1",
      accessToken: "access-1",
    });
    expect(exportToml(store)).toContain('refresh_token_sealed = "<set>"');
    expect(exportToml(store)).not.toContain("refresh-1");
  });

  test("a second account is refused", async () => {
    await connect();

    await expect(connect()).rejects.toBeInstanceOf(AlreadyConnected);
  });

  test("a wrong secret or code is an auth failure", async () => {
    const wrong = { ...app(), clientSecret: "nope" };

    await expect(client().exchange(wrong, strava.code)).rejects.toBeInstanceOf(StravaAuthFailed);
    await expect(client().exchange(app(), "stale")).rejects.toBeInstanceOf(StravaAuthFailed);
  });

  test("uses the access token while it is fresh", async () => {
    await connect();

    await client().get("/athlete");

    expect(strava.requests).toEqual(["POST /oauth/token", "GET /api/v3/athlete"]);
  });

  test("refreshes near expiry and keeps the new refresh token", async () => {
    await connect();
    strava.now += 6 * 3600 - 60;

    const athlete = await client().get<{ id: number }>("/athlete");

    expect(athlete.id).toBe(777);
    expect(accounts.credentials()?.refreshToken).toBe("refresh-2");
    // The old refresh token is gone at Strava, so only the saved one could work.
    strava.now += 6 * 3600;
    await client().get("/athlete");
    expect(accounts.credentials()?.refreshToken).toBe("refresh-3");
  });

  test("a revoked access token is refreshed once and retried", async () => {
    await connect();
    strava.revokeAccess();

    await client().get("/athlete");

    expect(strava.requests.slice(1)).toEqual([
      "GET /api/v3/athlete",
      "POST /oauth/token",
      "GET /api/v3/athlete",
    ]);
  });

  test("a revoked app marks the account auth_failed", async () => {
    await connect();
    strava.revokeAll();

    await expect(client().get("/athlete")).rejects.toBeInstanceOf(StravaAuthFailed);
    expect(accounts.get()?.status).toBe("auth_failed");
  });

  test("a failing Strava is unavailable and leaves the account alone", async () => {
    await connect();
    strava.status = 503;

    await expect(client().get("/athlete")).rejects.toBeInstanceOf(StravaUnavailable);
    expect(accounts.get()?.status).toBe("ok");
  });

  test("deauthorize revokes the tokens", async () => {
    await connect();

    await client().deauthorize();

    expect(strava.deauthorized).toBe(true);
  });
});
