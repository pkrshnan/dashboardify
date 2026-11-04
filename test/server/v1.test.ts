import { afterEach, beforeEach, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { create, fromBinary, toBinary } from "@bufbuild/protobuf";
import { GetHomeRequestSchema, HomeSchema } from "../../src/gen/dashboardify/v1/home_pb";
import { createApp } from "../../src/server/app";
import { fetchHome } from "../../web/api";

let dir: string;
let app: ReturnType<typeof createApp>;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "v1-"));
  await Bun.write(join(dir, "vault/Inbox.md"), "");
  app = createApp(
    {
      vaultPath: join(dir, "vault"),
      port: 0,
      timeZone: "UTC",
      healthRawPath: join(dir, "raw"),
      healthDerivedPath: join(dir, "derived"),
      tasksInbox: "Inbox.md",
      tokens: new Map([["test", "secret"]]),
    },
    { now: () => new Date("2026-11-03T12:00:00Z") },
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));
async function call(path: string, method = "GET", body?: unknown) {
  const response = await app.request(path, {
    method,
    headers: { authorization: "Bearer secret", "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const value = await response.json();
  return { status: response.status, body: value };
}
test("task lifecycle, retries, masks and concurrency", async () => {
  const created = await call("/v1/tasks?requestId=one", "POST", {
    description: "Call bank",
    dueDate: { year: 2026, month: 11, day: 4 },
  });
  expect(created.status).toBe(200);
  const name = created.body.name;
  expect((await call("/v1/tasks?requestId=one", "POST", { description: "retry" })).body.name).toBe(
    name,
  );
  expect(
    (
      await call(`/v1/${name}?updateMask=description`, "PATCH", {
        description: "Call Mum",
        etag: created.body.etag,
      })
    ).status,
  ).toBe(200);
  expect(
    (await call(`/v1/${name}`, "PATCH", { description: "stale", etag: created.body.etag })).status,
  ).toBe(409);
  expect((await call(`/v1/${name}:complete`, "POST", {})).body.task.state).toBe("STATE_DONE");
  expect((await call(`/v1/${name}:reopen`, "POST", {})).status).toBe(200);
  expect((await call("/v1/tasks:search?query=Mum")).body.matches).toHaveLength(1);
  expect((await call(`/v1/${name}`, "DELETE")).status).toBe(200);
  expect((await call(`/v1/${name}`)).status).toBe(404);
});
test("stream ingestion, schemas, missing rows and UTC validation", async () => {
  const payload = {
    day: { year: 2026, month: 11, day: 3 },
    timestamps: ["1793664000000", "1793664001000"],
    columns: [{ name: "bpm", numbers: { values: [60, 0] }, missingRows: [1] }],
  };
  const result = await call("/v1/streams/heart_rate:mergeSamples", "POST", payload);
  expect(result.status).toBe(200);
  expect(result.body.rows).toBe("2");
  expect((await call("/v1/streams/heart_rate")).body.columns[0].type).toBe("TYPE_NUMBER");
  expect((await call("/v1/streams")).body.streams).toHaveLength(1);
  expect(
    (await call("/v1/streams/heart_rate:mergeSamples", "POST", { ...payload, timestamps: ["0"] }))
      .status,
  ).toBe(400);
});
test("check-in masks replace tags and home uses the protobuf shape", async () => {
  expect(
    (await call("/v1/days/2026-11-03/checkin", "PATCH", { feel: 4, tags: ["sick"] })).status,
  ).toBe(200);
  const updated = await call("/v1/days/2026-11-03/checkin?updateMask=tags", "PATCH", {
    tags: ["alcohol"],
  });
  expect(updated.body.tags).toEqual(["alcohol"]);
  expect(updated.body.feel).toBe(4);
  expect((await call("/v1/home")).body.name).toBe("home");
  expect((await app.request("/v1/home")).status).toBe(401);
});
test("journal and message creation and pagination", async () => {
  const path = "/v1/days/2026-11-03/journalEntries";
  expect((await call(path, "POST", { text: "Hello\nworld" })).status).toBe(200);
  expect((await call(path)).body.journalEntries[0].text).toBe("Hello\nworld");
  const m = { sender: "Alice", text: "Hello", receiveTime: "2026-11-03T12:00:00Z" };
  expect((await call("/v1/messages?messageId=one", "POST", m)).status).toBe(200);
  expect((await call("/v1/messages?messageId=one", "POST", m)).status).toBe(409);
  expect((await call("/v1/messages")).body.messages).toHaveLength(1);
});
test("voice RPC creates a task through the service contract", async () => {
  const result = await call("/dashboardify.v1.VoiceService/AddTask", "POST", {
    text: "Call Mum tomorrow",
    requestId: "voice",
  });
  expect(result.status).toBe(200);
  expect(result.body.task).toStartWith("tasks/");
});
test("journal retries return the original entry after another write", async () => {
  const path = "/v1/days/2026-11-03/journalEntries";
  const first = await call(`${path}?requestId=first`, "POST", { text: "first" });
  await call(path, "POST", { text: "second" });
  const retry = await call(`${path}?requestId=first`, "POST", { text: "first" });
  expect(retry.body).toEqual(first.body);
  expect((await call(path)).body.journalEntries).toHaveLength(2);
});
test("list pagination and filters", async () => {
  await call("/v1/tasks", "POST", {
    description: "one",
    dueDate: { year: 2026, month: 11, day: 3 },
  });
  await call("/v1/tasks", "POST", {
    description: "two",
    dueDate: { year: 2026, month: 11, day: 4 },
  });
  const first = await call("/v1/tasks?page_size=1");
  expect(first.body.tasks).toHaveLength(1);
  expect(first.body.nextPageToken).toBeTruthy();
  const next = await call(`/v1/tasks?pageSize=1&pageToken=${first.body.nextPageToken}`);
  expect(next.body.tasks[0].name).not.toBe(first.body.tasks[0].name);
  expect(
    (
      await call(
        `/v1/tasks?filter=${encodeURIComponent('state = STATE_OPEN AND due_date < "2026-11-04"')}`,
      )
    ).body.tasks,
  ).toHaveLength(1);
});

test("Connect accepts binary protobuf requests", async () => {
  const response = await app.request("/dashboardify.v1.HomeService/GetHome", {
    method: "POST",
    headers: {
      authorization: "Bearer secret",
      "content-type": "application/proto",
      "connect-protocol-version": "1",
    },
    body: toBinary(GetHomeRequestSchema, create(GetHomeRequestSchema, { name: "home" })),
  });
  expect(response.status).toBe(200);
  expect(fromBinary(HomeSchema, new Uint8Array(await response.arrayBuffer())).name).toBe("home");
});

test("new task captures remain unique during concurrent retries", async () => {
  const responses = await Promise.all(
    Array.from({ length: 5 }, () =>
      call("/v1/tasks?requestId=concurrent", "POST", { description: "Once" }),
    ),
  );
  expect(new Set(responses.map((r) => r.body.name)).size).toBe(1);
  expect((await call("/v1/tasks")).body.tasks).toHaveLength(1);
});

test("home UI adapter preserves the presentation model", async () => {
  const original = globalThis.fetch;
  globalThis.fetch = ((url: string, init?: RequestInit) => app.request(url, init)) as typeof fetch;
  try {
    const modern = await fetchHome("secret");
    const legacy = await call("/api/home");
    expect(modern).toEqual(legacy.body);
  } finally {
    globalThis.fetch = original;
  }
});

test("legacy message history never appears in the task collection", async () => {
  await call("/api/ingest/messages", "POST", {
    id: "legacy",
    sender: "Alice",
    text: "A message",
    received_at: "2026-11-03T12:00:00Z",
  });
  await call("/v1/tasks", "POST", { description: "A task" });
  const tasks = await call("/v1/tasks");
  expect(tasks.body.tasks).toHaveLength(1);
  expect(tasks.body.tasks[0].description).toBe("A task");
  const messages = await call("/v1/messages");
  expect(messages.body.messages).toHaveLength(1);
  expect(messages.body.messages[0].text).toBe("A message");
});
