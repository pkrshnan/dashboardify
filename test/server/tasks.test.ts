import { afterEach, beforeEach, describe, expect, setSystemTime, test } from "bun:test";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";

type Json = Record<string, unknown>;

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
    tokens: new Map([["iphone", TOKEN]]),
  };
  app = createApp(config);
});
afterEach(async () => {
  setSystemTime();
  await rm(dir, { recursive: true, force: true });
});

const auth = { authorization: `Bearer ${TOKEN}` };
const post = (path: string, body?: unknown) =>
  app.request(`/api${path}`, {
    method: "POST",
    headers: { ...auth, "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });
const get = async (path: string) =>
  (await app.request(`/api${path}`, { headers: auth })).json() as Promise<Json>;
const file = (rel: string) => readFile(join(dir, rel), "utf8");
const put = async (rel: string, text: string) => {
  await mkdir(join(dir, rel, ".."), { recursive: true });
  await writeFile(join(dir, rel), text);
};

describe("POST /api/tasks", () => {
  test("appends a Tasks line to the inbox, reading the date from the text", async () => {
    const res = await post("/tasks", {
      key: "a1",
      text: "Call the bank tomorrow at 9am",
      source: "siri",
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as Json;
    expect(body.status).toBe("created");
    expect(body.message).toBe("Added Call the bank, due tomorrow at 09:00.");
    expect(await file("Inbox.md")).toBe(
      `- [ ] Call the bank ⏰ 09:00 📅 2026-11-03 ➕ 2026-11-02 🆔 ${body.id}\n`,
    );
  });

  test("explicit fields win over the text", async () => {
    await post("/tasks", {
      key: "a2",
      text: "Pay rent on Friday",
      due: "2026-11-30",
      priority: "high",
    });
    expect(await file("Inbox.md")).toContain("- [ ] Pay rent on Friday ⏫ 📅 2026-11-30");
  });

  test("the same key twice adds one task", async () => {
    await post("/tasks", { key: "same", text: "Buy milk" });
    const res = await post("/tasks", { key: "same", text: "Buy milk" });
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).status).toBe("already_done");
    expect((await file("Inbox.md")).split("\n").filter(Boolean)).toHaveLength(1);
  });

  test("rejects bad input", async () => {
    expect((await post("/tasks", { text: "no key" })).status).toBe(400);
    expect((await post("/tasks", { key: "k", text: "x", time: "9am" })).status).toBe(400);
    expect((await post("/tasks", { key: "k", text: "x", priority: "urgent" })).status).toBe(400);
  });
});

describe("GET /api/tasks", () => {
  beforeEach(() =>
    put(
      "Projects/Home.md",
      [
        "# Home",
        "- [ ] Fix the tap 📅 2026-11-01",
        "- [ ] Water plants 📅 2026-11-02",
        "- [ ] Clean gutters 📅 2026-11-05",
        "- [x] Old thing 📅 2026-11-02 ✅ 2026-11-02",
        "- [ ] Someday",
      ].join("\n"),
    ),
  );

  test("filters by due window and skips done tasks", async () => {
    const names = async (due: string) =>
      ((await get(`/tasks?due=${due}`)).items as Json[]).map((t) => t.description);
    expect(await names("today")).toEqual(["Water plants"]);
    expect(await names("overdue")).toEqual(["Fix the tap"]);
    expect(await names("week")).toEqual(["Water plants", "Clean gutters"]);
    expect(await names("all")).toEqual(["Fix the tap", "Water plants", "Clean gutters", "Someday"]);
  });

  test("includes a sentence to read aloud", async () => {
    expect((await get("/tasks?due=today")).message).toBe("1 task due today: Water plants.");
    expect((await get("/tasks?due=week")).message).toBe(
      "2 tasks due this week: Water plants and Clean gutters.",
    );
  });

  test("fuzzy matches open tasks", async () => {
    const items = (await get("/tasks/match?q=gutter")).items as Json[];
    expect(items[0]?.description).toBe("Clean gutters");
  });
});

describe("POST /api/tasks/:id/complete", () => {
  test("ticks the task off in place and is safe to retry", async () => {
    await put("Home.md", "# Home\n  - [ ] Fix the tap 🆔 abc123\nmore text\n");
    const res = await post("/tasks/abc123/complete");
    expect(res.status).toBe(200);
    expect(((await res.json()) as Json).message).toBe("Done: Fix the tap.");
    expect(await file("Home.md")).toBe(
      "# Home\n  - [x] Fix the tap ✅ 2026-11-02 🆔 abc123\nmore text\n",
    );
    expect(((await (await post("/tasks/abc123/complete")).json()) as Json).status).toBe(
      "already_done",
    );
  });

  test("a recurring task gets its next occurrence above it", async () => {
    await put("Home.md", "- [ ] Take out bins 🔁 every week 📅 2026-11-02 🆔 bins01\n");
    const body = (await (await post("/tasks/bins01/complete")).json()) as Json;
    expect(body.message).toBe("Done: Take out bins. Next one is November 9.");
    const [next, done] = (await file("Home.md")).split("\n");
    expect(next).toMatch(/^- \[ \] Take out bins 🔁 every week 📅 2026-11-09 🆔 [0-9a-f]{6}$/);
    expect(done).toBe("- [x] Take out bins 🔁 every week 📅 2026-11-02 ✅ 2026-11-02 🆔 bins01");
  });

  test("tasks without an id can be completed by the id the list gives them", async () => {
    await put("Home.md", "- [ ] Call mum\n");
    const [task] = (await get("/tasks")).items as Json[];
    await post(`/tasks/${task?.id}/complete`);
    expect(await file("Home.md")).toBe("- [x] Call mum ✅ 2026-11-02\n");
  });

  test("unknown ids are 404", async () => {
    expect((await post("/tasks/nope/complete")).status).toBe(404);
  });
});

describe("recurring tasks without an id", () => {
  test("the next occurrence can be completed too", async () => {
    await put("Home.md", "- [ ] Water plants 🔁 every day 📅 2026-11-02\n");
    const [first] = (await get("/tasks")).items as Json[];
    await post(`/tasks/${first?.id}/complete`);
    const [second] = (await get("/tasks")).items as Json[];
    expect(second?.due).toBe("2026-11-03");
    await post(`/tasks/${second?.id}/complete`);
    expect(await file("Home.md")).toBe(
      [
        "- [ ] Water plants 🔁 every day 📅 2026-11-04",
        "- [x] Water plants 🔁 every day 📅 2026-11-03 ✅ 2026-11-02",
        "- [x] Water plants 🔁 every day 📅 2026-11-02 ✅ 2026-11-02",
        "",
      ].join("\n"),
    );
  });
});
