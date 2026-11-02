import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../src/app";
import type { Config } from "../src/config";

const TOKEN = "test-token-0123456789";
let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vault-"));
  const config: Config = { vaultPath: dir, port: 0, timeZone: "America/Los_Angeles", tokens: new Map([["iphone", TOKEN]]) };
  app = createApp(config);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const post = (path: string, body: unknown, token = TOKEN) =>
  app.request(`/api${path}`, {
    method: "POST",
    headers: { authorization: `Bearer ${token}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });
const file = (rel: string) => readFile(join(dir, rel), "utf8");

describe("auth", () => {
  test("rejects a wrong or missing token", async () => {
    expect((await post("/ingest/journal", { text: "hi" }, "nope")).status).toBe(401);
    expect((await app.request("/api/today")).status).toBe(401);
  });
});

describe("journal", () => {
  test("appends to today's note in the configured time zone", async () => {
    // 02:30 UTC on Nov 2 is 18:30 PST on Nov 1 (DST ended that morning).
    const res = await post("/ingest/journal", { text: "Long walk.\nFelt good.", at: "2026-11-02T02:30:00Z" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ path: "daily/2026/2026-11-01.md" });
    await post("/ingest/journal", { text: "Bed.", at: "2026-11-02T06:00:00Z" });
    const note = await file("daily/2026/2026-11-01.md");
    expect(note).toContain("## Journal\n\n- 18:30 Long walk.\n  Felt good.\n- 22:00 Bed.\n");
    expect(note).toContain("date: 2026-11-01");
  });

  test("validates input", async () => {
    expect((await post("/ingest/journal", { text: "  " })).status).toBe(400);
    expect((await post("/ingest/journal", { text: "x", at: "yesterday" })).status).toBe(400);
  });
});

describe("health", () => {
  test("writes frontmatter and upserts the monthly CSV", async () => {
    await post("/ingest/health", { date: "2026-11-02", source: "whoop", metrics: { recovery: 64, hrv_ms: "58.237" } });
    await post("/ingest/health", { date: "2026-11-01", metrics: { steps: 8412 } });
    await post("/ingest/health", { date: "2026-11-02", source: "whoop", metrics: { recovery: 70 } });
    expect(await file("health/2026/2026-11.csv")).toBe(
      "date,hrv_ms,recovery,steps,source\n2026-11-01,,,8412,apple-health\n2026-11-02,58.24,70,,whoop\n",
    );
    const note = await file("daily/2026/2026-11-02.md");
    expect(note).toContain("recovery: 70");
    expect(note).toContain("hrv_ms: 58.24");
  });

  test("rejects unsafe names and non-numbers", async () => {
    expect((await post("/ingest/health", { date: "2026-11-02", metrics: { "../x": 1 } })).status).toBe(400);
    expect((await post("/ingest/health", { date: "2026-11-02", metrics: { tags: 1 } })).status).toBe(400);
    expect((await post("/ingest/health", { date: "2026-11-02", metrics: { steps: "lots" } })).status).toBe(400);
    expect((await post("/ingest/health", { date: "2026-02-30", metrics: { steps: 1 } })).status).toBe(400);
    expect((await post("/ingest/health", { date: "2026-11-02", source: "a,b", metrics: { steps: 1 } })).status).toBe(400);
  });
});

describe("reminders", () => {
  test("rewrites the mirror grouped by list", async () => {
    await post("/ingest/reminders", {
      items: [
        { id: "a", title: "Call dentist", list: "Personal", due: "2026-11-04T09:00:00-08:00" },
        { id: "b", title: "Renew lease", list: "Home" },
        { id: "c", title: "Done thing", list: "Personal", completed: true },
      ],
    });
    const out = await file("tasks/reminders.md");
    expect(out).toContain("## Home\n\n- [ ] Renew lease <!-- id:b -->");
    expect(out).toContain("## Personal\n\n- [ ] Call dentist 📅 2026-11-04 <!-- id:a -->\n- [x] Done thing <!-- id:c -->");
    await post("/ingest/reminders", { items: [] });
    expect(await file("tasks/reminders.md")).toContain("_No open reminders._");
  });
});

describe("messages", () => {
  test("appends to a local-only daily file and skips duplicates", async () => {
    const msg = { id: "m1", sender: "Mom", text: "Call me\nwhen free", received_at: "2026-11-02T20:05:00Z" };
    expect((await (await post("/ingest/messages", msg)).json()).duplicate).toBe(false);
    expect((await (await post("/ingest/messages", msg)).json()).duplicate).toBe(true);
    const out = await file("inbox/messages/2026-11-02.md");
    expect(out).toContain("privacy: local-only");
    expect(out.match(/Call me when free/g)?.length).toBe(1);
    expect(out).toContain("- 12:05 **Mom**: Call me when free <!-- id:m1 -->");
  });
});

describe("today", () => {
  test("returns the daily note", async () => {
    await post("/ingest/health", { date: "2026-11-02", metrics: { sleep_h: 7.1 } });
    const res = await app.request("/api/today?date=2026-11-02", { headers: { authorization: `Bearer ${TOKEN}` } });
    const json = await res.json();
    expect(json.frontmatter.sleep_h).toBe(7.1);
    expect(json.path).toBe("daily/2026/2026-11-02.md");
  });
});

describe("concurrency", () => {
  test("parallel journal writes are all kept", async () => {
    await Promise.all(
      Array.from({ length: 20 }, (_, i) => post("/ingest/journal", { text: `entry ${i}`, at: "2026-11-02T18:00:00Z" })),
    );
    const note = await file("daily/2026/2026-11-02.md");
    expect(note.match(/entry \d+/g)?.length).toBe(20);
  });
});
