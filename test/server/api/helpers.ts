import { afterEach, beforeEach } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarAccounts } from "../../../src/calendar/accounts";
import { EventCache } from "../../../src/calendar/cache";
import { CalDavClient } from "../../../src/calendar/caldav";
import { cacheSource } from "../../../src/calendar/source";
import { CalendarSync } from "../../../src/calendar/sync";
import type { CalendarSource } from "../../../src/home/calendar";
import { Photon } from "../../../src/places/photon";
import type { ConnectCalDav } from "../../../src/server/api/calendar-accounts";
import { type AppDeps, createApp } from "../../../src/server/app";
import { GeneralSettings } from "../../../src/settings/core";
import { DeviceStore } from "../../../src/settings/devices";
import { SecretBox } from "../../../src/settings/secret-box";
import type { SetupCode } from "../../../src/settings/setup-code";
import { SettingsStore } from "../../../src/settings/store";
import type { FakeCalDav } from "../../calendar/fake-caldav";
import type { FakePhoton } from "../../places/fake-photon";

/** CalDAV through the fake server, or a client that fails if a test reaches the network. */
function fakeConnect(server: (() => FakeCalDav) | undefined): ConnectCalDav {
  return (account) =>
    new CalDavClient({ ...account, allowedDomains: ["icloud.com"] }, (request) => {
      if (!server) {
        throw new Error(`Test tried to reach ${request.url}`);
      }
      return server().fetch(request);
    });
}

/**
 * Call inside a describe block to give each test an isolated vault, sample store and
 * settings.db, with one device ("test", token "secret"). `recompute` is passed to the app, e.g. to
 * watch what it recomputes.
 */
export function useApi(
  options: {
    calDav?: () => FakeCalDav;
    recompute?: AppDeps["recompute"];
    calendar?: CalendarSource;
    setupCode?: SetupCode;
    /** Answers calendar link requests. */
    feeds?: (request: Request) => Response;
    /** Answers place searches. */
    photon?: () => FakePhoton;
  } = {},
) {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let settings: SettingsStore;
  let cache: EventCache;
  let sync: CalendarSync;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "api-"));
    await Bun.write(join(dir, "vault/Inbox.md"), "");
    settings = await SettingsStore.open(join(dir, "data"), new SecretBox(randomBytes(32)));
    const devices = new DeviceStore(settings);
    devices.add("test", "secret");
    const accounts = new CalendarAccounts(settings);
    const connect = fakeConnect(options.calDav);
    cache = await EventCache.open(join(dir, "data"));
    const feedFetch = (request: Request) => {
      if (!options.feeds) {
        throw new Error(`Test tried to fetch ${request.url}`);
      }
      return Promise.resolve(options.feeds(request));
    };
    sync = new CalendarSync({
      accounts,
      cache,
      connect,
      feedFetch,
      timeZone: "UTC",
      log: () => undefined,
    });
    app = createApp(
      {
        vaultPath: join(dir, "vault"),
        port: 0,
        timeZone: "UTC",
        healthRawPath: join(dir, "raw"),
        healthDerivedPath: join(dir, "derived"),
        tasksInbox: "Inbox.md",
        dataPath: join(dir, "data"),
      },
      {
        devices,
        setupCode: options.setupCode,
        calendar: options.calendar ?? (options.calDav ? cacheSource(cache, accounts) : undefined),
        settings: {
          general: new GeneralSettings(settings),
          devices,
          calendars: { accounts, connect, cache, sync, feedFetch },
          places: new Photon("https://photon.test", (request) => {
            if (!options.photon) {
              throw new Error(`Test tried to search places: ${request.url}`);
            }
            return options.photon().fetch(request);
          }),
        },
        recompute: options.recompute,
        now: () => new Date("2026-11-03T12:00:00Z"),
      },
    );
  });

  afterEach(async () => {
    cache.close();
    settings.close();
    await rm(dir, { recursive: true, force: true });
  });

  return {
    get app() {
      return app;
    },
    /** The test's temporary directory: vault/, raw/ and derived/ live under it. */
    get dir() {
      return dir;
    },
    get settings() {
      return settings;
    },
    get cache() {
      return cache;
    },
    /** A file in the test's vault, such as Inbox.md. */
    vaultFile(name: string): Promise<string> {
      return Bun.file(join(dir, "vault", name)).text();
    },
    get sync() {
      return sync;
    },
    async call(path: string, method = "GET", body?: unknown, token = "secret") {
      const response = await app.request(path, {
        method,
        headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
