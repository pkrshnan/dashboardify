import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { buildConfig, DEFAULT_SETTINGS, loadStartup } from "../../src/server/config";

test("startup needs only a vault", () => {
  expect(() => loadStartup({})).toThrow("VAULT_PATH");
  expect(loadStartup({ VAULT_PATH: "/v", PORT: "9000" })).toMatchObject({
    vaultPath: "/v",
    port: 9000,
  });
});

test("settings live in ./data unless DATA_PATH says otherwise", () => {
  expect(loadStartup({ VAULT_PATH: "/v" }).dataPath).toBe(resolve("data"));
  expect(loadStartup({ VAULT_PATH: "/v", DATA_PATH: "/srv/settings" }).dataPath).toBe(
    "/srv/settings",
  );
  expect(loadStartup({ VAULT_PATH: "/v", SECRET_KEY_FILE: "/run/secrets/key" }).keyFile).toBe(
    "/run/secrets/key",
  );
});

test("the config takes Settings' time zone, and refuses a bad one", () => {
  const startup = loadStartup({ VAULT_PATH: "/v" });

  expect(buildConfig(startup, { ...DEFAULT_SETTINGS, timeZone: "Europe/London" }).timeZone).toBe(
    "Europe/London",
  );
  expect(() => buildConfig(startup, { ...DEFAULT_SETTINGS, timeZone: "Mars/Olympus" })).toThrow();
});
