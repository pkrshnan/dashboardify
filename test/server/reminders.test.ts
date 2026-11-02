import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, readFile, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";

const TOKEN = "test-token-0123456789";
let dir: string;
let app: ReturnType<typeof createApp>;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "vault-"));
  app = createApp({
    vaultPath: dir,
    port: 0,
    timeZone: "America/Los_Angeles",
    tokens: new Map([["iphone", TOKEN]]),
  });
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Loosely typed JSON body; each test checks the fields it cares about. */
type Json = Record<string, unknown>;

const sync = async (body: unknown) => {
  const res = await app.request("/api/ingest/reminders", {
    method: "POST",
    headers: { authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Json };
};
const mirror = () => readFile(join(dir, "tasks/reminders.md"), "utf8");

const items = [
  { id: "a", title: "Renew lease", list: "Personal", due: "2026-10-31" },
  { id: "b", title: "Call insurance", list: "Personal", due: "2026-11-03T01:00:00Z" },
];

test("full sync writes the mirror with local due times", async () => {
  const { status, json } = await sync({ items });
  expect(status).toBe(200);
  expect(json).toMatchObject({
    changed: true,
    diff: { added: ["a", "b"], updated: [], removed: [] },
  });
  expect(await mirror()).toContain("- [ ] Call insurance 📅 2026-11-02 ⏰ 17:00 <!-- id:b -->");
});

test("an unchanged full sync does not touch the file", async () => {
  await sync({ items });
  const before = (await stat(join(dir, "tasks/reminders.md"))).mtimeMs;
  await Bun.sleep(5);
  const { json } = await sync({ items });
  expect(json).toMatchObject({ changed: false, diff: { added: [], updated: [], removed: [] } });
  expect((await stat(join(dir, "tasks/reminders.md"))).mtimeMs).toBe(before);
});

test("changes mode applies edits, completions and removals only", async () => {
  await sync({ items });
  const { json } = await sync({
    mode: "changes",
    items: [
      { id: "a", title: "Renew lease", completed: true },
      { id: "c", title: "Order lenses", list: "Personal" },
    ],
  });
  expect(json.diff).toEqual({ added: ["c"], updated: [], removed: ["a"] });
  const text = await mirror();
  expect(text).not.toContain("Renew lease");
  expect(text).toContain("Call insurance");
  expect(text).toContain("Order lenses");
});

test("records the last sync time for the Shortcut to filter on", async () => {
  const state = async () =>
    (
      await app.request("/api/ingest/reminders/state", {
        headers: { authorization: `Bearer ${TOKEN}` },
      })
    ).json() as Promise<Json>;
  expect(await state()).toEqual({ last_sync: null });
  await sync({ items });
  expect((await state()).last_sync).toMatch(/^\d{4}-\d{2}-\d{2}T/);
});

test("rejects bad input", async () => {
  expect((await sync({ items: "x" })).status).toBe(400);
  expect((await sync({ mode: "partial", items: [] })).status).toBe(400);
  expect((await sync({ items: [{ id: "a" }] })).status).toBe(400);
  expect((await sync({ items: [{ id: "a", title: "x", due: "tomorrow" }] })).status).toBe(400);
  expect((await sync({ items: [], removed_ids: ["a"] })).status).toBe(400);
  expect((await sync({ mode: "changes", items: [], removed_ids: [1] })).status).toBe(400);
});

test("titles cannot break the file structure", async () => {
  await sync({ items: [{ id: "x -->", title: "Evil\n## Heading <!-- id:y -->", list: "A\nB" }] });
  const text = await mirror();
  expect(text).toContain("## A B\n\n- [ ] Evil ## Heading id:y <!-- id:x -->");
});
