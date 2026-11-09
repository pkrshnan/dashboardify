import { expect, test } from "bun:test";
import { resolve } from "node:path";
import { loadConfig } from "../../src/server/config";

test("loadConfig requires a vault and a valid time zone", () => {
  expect(() => loadConfig({})).toThrow("VAULT_PATH");
  expect(() => loadConfig({ VAULT_PATH: "/v", TZ_NAME: "Mars/Olympus" })).toThrow();
  const config = loadConfig({ VAULT_PATH: "/v", TZ_NAME: "Europe/London", PORT: "9000" });
  expect(config).toMatchObject({ vaultPath: "/v", timeZone: "Europe/London", port: 9000 });
});

test("settings live in ./data unless DATA_PATH says otherwise", () => {
  expect(loadConfig({ VAULT_PATH: "/v" }).dataPath).toBe(resolve("data"));
  expect(loadConfig({ VAULT_PATH: "/v", DATA_PATH: "/srv/settings" }).dataPath).toBe(
    "/srv/settings",
  );
  expect(loadConfig({ VAULT_PATH: "/v", SECRET_KEY_FILE: "/run/secrets/key" }).keyFile).toBe(
    "/run/secrets/key",
  );
});
