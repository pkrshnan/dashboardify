import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";
import { tokenDevices } from "./devices";

const TOKEN = "test-token-0123456789";
let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  setSystemTime(new Date("2026-11-02T18:00:00Z"));
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
  app = createApp(config, { devices: tokenDevices({ iphone: TOKEN }) });
});
afterEach(async () => {
  setSystemTime();
  await rm(dir, { recursive: true, force: true });
});

const post = (body: unknown) =>
  app.request("/api/health/checkin", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}`, "content-type": "application/json" },
    body: JSON.stringify(body),
  });

describe("POST /api/health/checkin", () => {
  test("writes feel, effort and tags to the daily note, merging tags", async () => {
    const res = await post({ feel: "4", rpe: 7, tags: "Alcohol, late meal" });
    expect(res.status).toBe(201);
    const body = (await res.json()) as { message: string };
    expect(body.message).toBe("Logged feeling 4 out of 5; effort 7 out of 10; alcohol, late meal.");
    await post({ date: "2026-11-02", tags: ["travel", "alcohol"] });
    const note = await readFile(join(dir, "daily", "2026", "2026-11-02.md"), "utf8");
    expect(note).toContain("feel: 4");
    expect(note).toContain("effort_rpe: 7");
    expect(note).toMatch(/alcohol[\s\S]*late meal[\s\S]*travel/);
  });

  test("rejects out-of-range or empty check-ins", async () => {
    expect((await post({ feel: 6 })).status).toBe(400);
    expect((await post({ rpe: 2.5 })).status).toBe(400);
    expect((await post({})).status).toBe(400);
  });
});
