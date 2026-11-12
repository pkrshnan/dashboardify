import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { SecretBox } from "../../src/settings/secret-box";
import { SettingsStore } from "../../src/settings/store";
import { StravaAccounts } from "../../src/strava/account";
import { RunCache } from "../../src/strava/cache";
import { StravaClient } from "../../src/strava/client";
import { StravaSync } from "../../src/strava/sync";
import { FakeStrava } from "./fake-strava";

const ZONE = "America/Los_Angeles";
/** 11 Nov 2026, 12:00 in Los Angeles. */
const NOW = Date.parse("2026-11-11T20:00:00Z");

let dir: string;
let store: SettingsStore;
let cache: RunCache;
let strava: FakeStrava;
let accounts: StravaAccounts;
let changed: string[][];
let logs: string[];
let now: number;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "strava-sync-"));
  store = await SettingsStore.open(dir, new SecretBox(randomBytes(32)));
  cache = await RunCache.open(dir);
  strava = new FakeStrava();
  strava.now = NOW / 1000;
  accounts = new StravaAccounts(store, () => new Date(now));
  changed = [];
  logs = [];
  now = NOW;
  const client = new StravaClient(accounts, strava.fetch, strava.baseUrl, () => now);
  const app = { clientId: strava.clientId, clientSecret: strava.clientSecret };
  const { athlete, tokens } = await client.exchange(app, strava.code);
  accounts.create(athlete, app, tokens);
  strava.requests.length = 0;
});

afterEach(async () => {
  cache.close();
  store.close();
  await rm(dir, { recursive: true, force: true });
});

function sync(): StravaSync {
  return new StravaSync({
    accounts,
    cache,
    client: new StravaClient(accounts, strava.fetch, strava.baseUrl, () => now),
    timeZone: ZONE,
    onChanged: (dates) => changed.push(dates),
    now: () => now,
    log: (message) => logs.push(message),
  });
}

const all = () => cache.between(0, Number.MAX_SAFE_INTEGER);

describe("StravaSync", () => {
  test("the first pass keeps runs from the last 90 days and touches their local dates", async () => {
    strava.addActivity("2026-11-11T18:42:00Z", 32, { distance: 5100 });
    strava.addActivity("2026-11-10T06:30:00Z", 40);
    strava.addActivity("2026-11-09T17:00:00Z", 60, { sport_type: "Ride" });
    strava.addActivity("2026-07-01T17:00:00Z", 30);

    await sync().tick();

    expect(all().map((r) => r.start)).toEqual([
      Date.parse("2026-11-10T06:30:00Z"),
      Date.parse("2026-11-11T18:42:00Z"),
    ]);
    expect(all()[1]).toMatchObject({ distanceMeters: 5100, elapsedSeconds: 32 * 60 });
    // 06:30 UTC on the 10th is the evening of the 9th in Los Angeles.
    expect(changed).toEqual([["2026-11-09", "2026-11-11"]]);
    expect(accounts.get()?.lastSyncTime).toBe(new Date(NOW).toISOString());
  });

  test("later passes look back two days from the newest run and touch nothing unchanged", async () => {
    strava.addActivity("2026-11-11T18:42:00Z", 32);
    const old = strava.addActivity("2026-11-05T18:00:00Z", 30);
    const s = sync();
    await s.tick();
    changed = [];

    // Gone at Strava, but before the window, so it isn't asked about again.
    strava.activities.splice(strava.activities.indexOf(old), 1);
    await s.tick();

    expect(changed).toEqual([]);
    expect(all()).toHaveLength(2);
  });

  test("an edited, a deleted and a late-uploaded run each touch their dates", async () => {
    const edited = strava.addActivity("2026-11-11T18:42:00Z", 32);
    const deleted = strava.addActivity("2026-11-10T18:00:00Z", 20);
    const s = sync();
    await s.tick();
    changed = [];

    edited.distance = 5300;
    strava.activities.splice(strava.activities.indexOf(deleted), 1);
    strava.addActivity("2026-11-10T16:00:00Z", 25);
    await s.tick();

    expect(changed).toEqual([["2026-11-10", "2026-11-11"]]);
    expect(all().map((r) => r.distanceMeters)).toEqual([25 * 160, 5300]);
  });

  test("reads every page", async () => {
    for (let i = 0; i < 205; i++) {
      strava.addActivity(new Date(NOW - (i + 1) * 3_600_000).toISOString(), 10, {
        sport_type: i % 2 ? "Walk" : "Run",
      });
    }

    await sync().tick();

    expect(strava.requests).toEqual([
      "GET /api/v3/athlete/activities",
      "GET /api/v3/athlete/activities",
    ]);
    expect(all()).toHaveLength(103);
  });

  test("disconnecting forgets the runs and touches their dates", async () => {
    strava.addActivity("2026-11-11T18:42:00Z", 32);
    const s = sync();
    await s.tick();
    changed = [];

    accounts.delete();
    await s.tick();

    expect(all()).toEqual([]);
    expect(changed).toEqual([["2026-11-11"]]);
  });

  test("a refused token stops polling until you connect again", async () => {
    strava.revokeAll();
    now += 6 * 3_600_000;
    const s = sync();

    await s.tick();
    await s.tick();

    expect(accounts.get()?.status).toBe("auth_failed");
    expect(strava.requests.filter((r) => r === "POST /oauth/token")).toHaveLength(1);
  });

  test("a failing Strava backs off, then syncs", async () => {
    strava.addActivity("2026-11-11T18:42:00Z", 32);
    strava.status = 429;
    const s = sync();

    await s.tick();
    strava.status = undefined;
    now += 10 * 60_000;
    await s.tick();
    expect(all()).toEqual([]);

    now += 60 * 60_000;
    await s.tick();

    expect(logs[0]).toContain("retrying in 30 min");
    expect(all()).toHaveLength(1);
  });
});
