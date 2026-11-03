import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { gzipSync } from "node:zlib";
import { parquetReadObjects } from "hyparquet";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";

const TOKEN = "test-token-0123456789";
const T0 = Date.parse("2026-11-02T00:00:00Z");
let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "raw-"));
  const config: Config = {
    vaultPath: join(dir, "vault"),
    port: 0,
    timeZone: "America/Los_Angeles",
    healthRawPath: join(dir, "health-raw"),
    tasksInbox: "Inbox.md",
    tokens: new Map([["iphone", TOKEN]]),
  };
  app = createApp(config);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const upload = (stream: string, csv: string, { day = "2026-11-02", gzip = true } = {}) =>
  app.request(`/api/ingest/samples/${stream}?day=${day}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${TOKEN}`,
      "content-type": "text/csv",
      ...(gzip ? { "content-encoding": "gzip" } : {}),
    },
    body: gzip ? gzipSync(csv) : csv,
  });
const readDay = async (stream: string) => {
  const bytes = await readFile(join(dir, "health-raw", stream, "2026/11/2026-11-02.parquet"));
  return parquetReadObjects({ file: new Uint8Array(bytes).buffer });
};

describe("POST /api/ingest/samples/:stream", () => {
  test("stores a gzipped day as Parquet", async () => {
    const res = await upload("heart_rate", `ts,bpm\n${T0},58\n${T0 + 1000},59\n`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ rows: 2, added: 2, replaced: 0 });
    expect(await readDay("heart_rate")).toEqual([
      { ts: BigInt(T0), bpm: 58 },
      { ts: BigInt(T0 + 1000), bpm: 59 },
    ]);
  });

  test("merges later uploads by ts, newer wins", async () => {
    await upload("heart_rate", `ts,bpm\n${T0},58\n${T0 + 1000},59\n`);
    const res = await upload("heart_rate", `ts,bpm\n${T0 + 1000},60\n${T0 + 2000},61\n`);
    expect(await res.json()).toEqual({ rows: 3, added: 1, replaced: 1 });
    expect((await readDay("heart_rate")).map((r) => r.bpm)).toEqual([58, 60, 61]);
  });

  test("keeps text and empty cells", async () => {
    await upload("battery", `ts,pct,state\n${T0},,charging\n`, { gzip: false });
    expect(await readDay("battery")).toEqual([{ ts: BigInt(T0), pct: null, state: "charging" }]);
  });

  test("rejects bad requests with a reason", async () => {
    const error = async (res: Response) => ((await res.json()) as { error: string }).error;
    expect(await error(await upload("Heart-Rate", "ts\n"))).toContain("stream");
    expect(await error(await upload("hr", "ts\n", { day: "2026-13-01" }))).toContain("day");
    expect(await error(await upload("hr", `ts,bpm\n${T0 + 86_400_000},60\n`))).toBe(
      "line 2: ts is outside the day",
    );
    await upload("hr", `ts,bpm\n${T0},60\n`);
    expect(await error(await upload("hr", `ts,rate\n${T0},60\n`))).toBe("header must be ts,bpm");
  });

  test("rejects a body that isn't gzip when it says it is", async () => {
    const res = await app.request("/api/ingest/samples/hr?day=2026-11-02", {
      method: "POST",
      headers: { authorization: `Bearer ${TOKEN}`, "content-encoding": "gzip" },
      body: "ts,bpm\n",
    });
    expect(res.status).toBe(400);
  });
});
