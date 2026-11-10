import { describe, expect, test } from "bun:test";
import { warnRetiredEnv } from "../../src/settings/retired-env";

describe("warnRetiredEnv", () => {
  test("names each retired variable still set, and where it lives now", () => {
    const log: string[] = [];

    warnRetiredEnv(
      { INGEST_TOKENS: "mac:abcdefghijklmnop", TZ_NAME: "Europe/London", TASKS_INBOX: " " },
      (line) => log.push(line),
    );

    expect(log).toEqual([
      "INGEST_TOKENS is no longer read. Remove it from .env and add devices in Settings › Devices or with bun run settings devices add.",
      "TZ_NAME is no longer read. Remove it from .env and set it in Settings › General.",
    ]);
  });

  test("says nothing when none is set", () => {
    const log: string[] = [];

    warnRetiredEnv({ VAULT_PATH: "/v", PORT: "8787" }, (line) => log.push(line));

    expect(log).toEqual([]);
  });
});
