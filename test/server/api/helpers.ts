import { afterEach, beforeEach } from "bun:test";
import { randomBytes } from "node:crypto";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../../src/server/app";
import "../../../src/settings/core";
import { DeviceStore } from "../../../src/settings/devices";
import { SecretBox } from "../../../src/settings/secret-box";
import { SettingsStore } from "../../../src/settings/store";

/**
 * Call inside a describe block to give each test an isolated vault, sample store and
 * settings.db, with one device ("test", token "secret").
 */
export function useApi() {
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
      { devices, now: () => new Date("2026-11-03T12:00:00Z") },
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
    async call(path: string, method = "GET", body?: unknown) {
      const response = await app.request(path, {
        method,
        headers: { authorization: "Bearer secret", "content-type": "application/json" },
        body: body === undefined ? undefined : JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() };
    },
  };
}
