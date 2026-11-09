import { afterEach, beforeEach } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarAccounts } from "../../../src/calendar/accounts";
import { CalDavClient } from "../../../src/calendar/caldav";
import type { ConnectCalDav } from "../../../src/server/api/calendar-accounts";
import { createApp } from "../../../src/server/app";
import { GeneralSettings, type SettingsChange } from "../../../src/settings/core";
import { DeviceStore } from "../../../src/settings/devices";
import { SecretBox } from "../../../src/settings/secret-box";
import { SettingsStore } from "../../../src/settings/store";
import type { FakeCalDav } from "../../calendar/fake-caldav";

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
 * settings.db, with one device ("test", token "secret").
 */
export function useApi(
  options: { envChange?: SettingsChange; envNames?: string[]; calDav?: () => FakeCalDav } = {},
) {
  let dir: string;
  let app: ReturnType<typeof createApp>;
  let settings: SettingsStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "api-"));
    await Bun.write(join(dir, "vault/Inbox.md"), "");
    settings = await SettingsStore.open(join(dir, "data"), new SecretBox(randomBytes(32)));
    const devices = new DeviceStore(settings);
    devices.add("test", "secret");
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
        settings: {
          general: new GeneralSettings(settings),
          devices,
          envChange: options.envChange ?? {},
          envNames: options.envNames ?? [],
          calendars: {
            accounts: new CalendarAccounts(settings),
            connect: fakeConnect(options.calDav),
          },
        },
        now: () => new Date("2026-11-03T12:00:00Z"),
      },
    );
  });

  afterEach(async () => {
    settings.close();
    await rm(dir, { recursive: true, force: true });
  });

  return {
    get app() {
      return app;
    },
    get settings() {
      return settings;
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
