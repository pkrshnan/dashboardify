import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";

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
    tasksInbox: "Inbox.md",
    tokens: new Map([
      ["iphone", TOKEN],
      ["mac", "another-token-abcdefgh"],
    ]),
  };
  app = createApp(config);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const post = (path: string, body: unknown, token = TOKEN) =>
  app.request(`/api${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
const file = (rel: string) => readFile(join(dir, rel), "utf8");

describe("auth", () => {
  test("rejects missing, wrong and differently-sized tokens", async () => {
    expect((await post("/ingest/journal", { text: "hi" }, "nope")).status).toBe(401);
    expect((await post("/ingest/journal", { text: "hi" }, `${TOKEN}x`)).status).toBe(401);
    expect((await app.request("/api/today")).status).toBe(401);
  });

  test("accepts any configured device", async () => {
    expect((await post("/ingest/journal", { text: "hi" }, "another-token-abcdefgh")).status).toBe(
      201,
    );
  });

  test("healthz is public", async () => {
    expect((await app.request("/healthz")).status).toBe(200);
  });
});

describe("POST /api/ingest/journal", () => {
  test("writes to the local day", async () => {
    const res = await post("/ingest/journal", { text: "Long walk.", at: "2026-11-02T02:30:00Z" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ path: "daily/2026/2026-11-01.md" });
    expect(await file("daily/2026/2026-11-01.md")).toContain("- 18:30 Long walk.");
  });

  test("validates input", async () => {
    expect((await post("/ingest/journal", { text: "  " })).status).toBe(400);
    expect((await post("/ingest/journal", { text: "x", at: "yesterday" })).status).toBe(400);
    expect((await post("/ingest/journal", { text: "x".repeat(20_001) })).status).toBe(400);
    expect((await post("/ingest/journal", "{not json")).status).toBe(400);
  });
});

describe("POST /api/ingest/messages", () => {
  test("appends and reports duplicates", async () => {
    const msg = {
      id: "m1",
      sender: "Sam",
      text: "Dinner at 19:00",
      received_at: "2026-11-02T20:05:00Z",
    };
    expect(await (await post("/ingest/messages", msg)).json()).toEqual({
      path: "inbox/messages/2026-11-02.md",
      duplicate: false,
    });
    const again = (await (await post("/ingest/messages", msg)).json()) as { duplicate: boolean };
    expect(again.duplicate).toBe(true);
  });

  test("validates input", async () => {
    expect((await post("/ingest/messages", { text: "x" })).status).toBe(400);
    expect((await post("/ingest/messages", { sender: "a" })).status).toBe(400);
    expect(
      (await post("/ingest/messages", { sender: "a", text: "x", received_at: 5 })).status,
    ).toBe(400);
  });
});

describe("GET /api/today", () => {
  test("returns the daily note, or an empty shell", async () => {
    await mkdir(join(dir, "daily/2026"), { recursive: true });
    await writeFile(join(dir, "daily/2026/2026-11-02.md"), "---\nsleep_h: 7.1\n---\n");
    const auth = { headers: { authorization: `Bearer ${TOKEN}` } };
    const found = (await (await app.request("/api/today?date=2026-11-02", auth)).json()) as {
      frontmatter: Record<string, unknown>;
    };
    expect(found.frontmatter.sleep_h).toBe(7.1);
    const empty = await (await app.request("/api/today?date=2026-11-03", auth)).json();
    expect(empty).toEqual({
      date: "2026-11-03",
      path: "daily/2026/2026-11-03.md",
      frontmatter: {},
      body: null,
    });
    expect((await app.request("/api/today?date=nope", auth)).status).toBe(400);
  });
});
