import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";
import { tokenDevices } from "./devices";

const TOKEN = "test-token-0123456789";
let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vault-"));
  const config: Config = {
    vaultPath: dir,
    port: 0,
    timeZone: "America/Los_Angeles",
    healthRawPath: join(dir, "..", "raw-unused"),
    healthDerivedPath: join(dir, "..", "derived-unused"),
    tasksInbox: "Inbox.md",
    dataPath: join(dir, "data"),
  };
  app = createApp(config, {
    devices: tokenDevices({ iphone: TOKEN, mac: "another-token-abcdefgh" }),
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const post = (path: string, body: unknown, token = TOKEN) =>
  app.request(path, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const get = (path: string, token = TOKEN) =>
  app.request(path, { headers: { authorization: `Bearer ${token}` } });
const file = (rel: string) => readFile(join(dir, rel), "utf8");
const JOURNAL = "/v1/days/2026-11-01/journalEntries";

describe("auth", () => {
  test("rejects missing, wrong and differently-sized tokens", async () => {
    expect((await get("/v1/days/2026-11-02", "nope")).status).toBe(401);
    expect((await get("/v1/days/2026-11-02", `${TOKEN}x`)).status).toBe(401);
    expect((await app.request("/v1/days/2026-11-02")).status).toBe(401);
  });

  test("accepts any configured device", async () => {
    expect((await get("/v1/days/2026-11-02", "another-token-abcdefgh")).status).toBe(200);
  });

  test("healthz is public", async () => {
    expect((await app.request("/healthz")).status).toBe(200);
  });

  test("the old /api routes are gone", async () => {
    expect((await get("/api/home")).status).toBe(404);
  });
});

describe("journal entries", () => {
  test("land on the local day", async () => {
    const res = await post(JOURNAL, { text: "Long walk.", entryTime: "2026-11-02T02:30:00Z" });

    expect(res.status).toBe(200);
    expect(await file("Daily/2026/2026-11-01.md")).toContain("- 18:30 Long walk.");
  });

  test("validate input", async () => {
    expect((await post(JOURNAL, { text: "  " })).status).toBe(400);
    expect((await post(JOURNAL, { text: "x", entryTime: "2026-11-03T02:30:00Z" })).status).toBe(
      400,
    );
    expect((await post(JOURNAL, { text: "x".repeat(20_001) })).status).toBe(400);
    expect((await post(JOURNAL, "{not json")).status).toBe(400);
  });
});

describe("messages", () => {
  test("append to the day's note and refuse a repeated id", async () => {
    const msg = { sender: "Sam", text: "Dinner at 19:00", receiveTime: "2026-11-02T20:05:00Z" };

    expect((await post("/v1/messages?messageId=m1", msg)).status).toBe(200);
    expect((await post("/v1/messages?messageId=m1", msg)).status).toBe(409);
    expect(await file("inbox/messages/2026-11-02.md")).toContain("**Sam**: Dinner at 19:00");
  });

  test("validate input", async () => {
    expect((await post("/v1/messages", { text: "x" })).status).toBe(400);
    expect((await post("/v1/messages", { sender: "a", text: "x", receiveTime: 5 })).status).toBe(
      400,
    );
  });
});

describe("days", () => {
  test("return the daily note, or an empty one", async () => {
    await mkdir(join(dir, "Daily/2026"), { recursive: true });
    await writeFile(join(dir, "Daily/2026/2026-11-02.md"), "---\nsleep_h: 7.1\n---\n");

    const found = (await (await get("/v1/days/2026-11-02")).json()) as {
      frontmatter: Record<string, unknown>;
    };
    const empty = await (await get("/v1/days/2026-11-03")).json();

    expect(found.frontmatter.sleep_h).toBe(7.1);
    expect(empty).toEqual({
      name: "days/2026-11-03",
      path: "Daily/2026/2026-11-03.md",
      frontmatter: {},
    });
    expect((await get("/v1/days/nope")).status).toBe(400);
  });
});

describe("web files", () => {
  test("serves the manifest's icons without a token", async () => {
    const res = await app.request("/icon.svg");

    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });
});
