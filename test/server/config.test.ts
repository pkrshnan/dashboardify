import { expect, test } from "bun:test";
import { loadConfig, parseTokens } from "../../src/server/config";

test("parseTokens reads device:token pairs", () => {
  expect(parseTokens("iphone:abcdefghijklmnop, mac:qrstuvwxyz012345")).toEqual(
    new Map([
      ["iphone", "abcdefghijklmnop"],
      ["mac", "qrstuvwxyz012345"],
    ]),
  );
  expect(parseTokens("").size).toBe(0);
});

test("parseTokens rejects short or malformed tokens", () => {
  expect(() => parseTokens("iphone:short")).toThrow("at least 16");
  expect(() => parseTokens("nocolon")).toThrow("bad INGEST_TOKENS");
  expect(() => parseTokens(":abcdefghijklmnop")).toThrow("bad INGEST_TOKENS");
});

test("loadConfig requires a vault and a valid time zone", () => {
  expect(() => loadConfig({})).toThrow("VAULT_PATH");
  expect(() => loadConfig({ VAULT_PATH: "/v", TZ_NAME: "Mars/Olympus" })).toThrow();
  const config = loadConfig({ VAULT_PATH: "/v", TZ_NAME: "Europe/London", PORT: "9000" });
  expect(config).toMatchObject({ vaultPath: "/v", timeZone: "Europe/London", port: 9000 });
});
