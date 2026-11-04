import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("tasks API", () => {
  const api = useApi();

  const dueDate = { year: 2026, month: 11, day: 4 };

  test("retries return the original task without appending another line", async () => {
    const first = await api.call("/v1/tasks?requestId=one", "POST", { description: "Call bank" });
    const retry = await api.call("/v1/tasks?requestId=one", "POST", { description: "Retry" });
    const listed = await api.call("/v1/tasks");

    expect(first.status).toBe(200);
    expect(retry.body.name).toBe(first.body.name);
    expect(retry.body.description).toBe("Call bank");
    expect(listed.body.tasks).toHaveLength(1);
  });

  test("a masked edit preserves other fields and rejects a stale etag", async () => {
    const created = await api.call("/v1/tasks", "POST", { description: "Call bank", dueDate });
    const path = `/v1/${created.body.name}`;

    const updated = await api.call(`${path}?updateMask=description`, "PATCH", {
      description: "Call Mum",
      etag: created.body.etag,
    });
    const stale = await api.call(path, "PATCH", { description: "Stale", etag: created.body.etag });

    expect(updated.status).toBe(200);
    expect(updated.body.description).toBe("Call Mum");
    expect(updated.body.dueDate).toEqual(dueDate);
    expect(stale.status).toBe(409);
  });

  test("completes and reopens an existing task", async () => {
    const created = await api.call("/v1/tasks", "POST", { description: "Call bank" });
    const path = `/v1/${created.body.name}`;

    const completed = await api.call(`${path}:complete`, "POST", {});
    const reopened = await api.call(`${path}:reopen`, "POST", {});
    const fetched = await api.call(path);

    expect(completed.body.task.state).toBe("STATE_DONE");
    expect(reopened.body.state).toBe("STATE_OPEN");
    expect(fetched.body.state).toBe("STATE_OPEN");
  });

  test("search returns matching open tasks", async () => {
    const created = await api.call("/v1/tasks", "POST", { description: "Call Mum" });

    const matches = await api.call("/v1/tasks:search?query=Mum");
    await api.call(`/v1/${created.body.name}:complete`, "POST", {});
    const completed = await api.call("/v1/tasks:search?query=Mum");

    expect(matches.body.matches[0].task.name).toBe(created.body.name);
    expect(completed.body.matches ?? []).toEqual([]);
  });

  test("deletes the task line so it can no longer be fetched", async () => {
    const created = await api.call("/v1/tasks", "POST", { description: "Call bank" });
    const path = `/v1/${created.body.name}`;

    const deleted = await api.call(path, "DELETE");
    const fetched = await api.call(path);
    const listed = await api.call("/v1/tasks");

    expect(deleted.status).toBe(200);
    expect(fetched.status).toBe(404);
    expect(listed.body.tasks ?? []).toEqual([]);
  });

  test("paginates in due order and applies state and date filters", async () => {
    await api.call("/v1/tasks", "POST", {
      description: "Earlier",
      dueDate: { ...dueDate, day: 3 },
    });
    await api.call("/v1/tasks", "POST", { description: "Later", dueDate });
    const filter = encodeURIComponent('state = STATE_OPEN AND due_date < "2026-11-04"');

    const first = await api.call("/v1/tasks?page_size=1");
    const next = await api.call(`/v1/tasks?pageSize=1&pageToken=${first.body.nextPageToken}`);
    const filtered = await api.call(`/v1/tasks?filter=${filter}`);

    expect(first.body.tasks[0].description).toBe("Earlier");
    expect(next.body.tasks[0].description).toBe("Later");
    expect(filtered.body.tasks).toHaveLength(1);
    expect(filtered.body.tasks[0].description).toBe("Earlier");
  });

  test("concurrent retries create only one task", async () => {
    const responses = await Promise.all(
      Array.from({ length: 5 }, () =>
        api.call("/v1/tasks?requestId=concurrent", "POST", { description: "Once" }),
      ),
    );
    const listed = await api.call("/v1/tasks");

    expect(new Set(responses.map((response) => response.body.name)).size).toBe(1);
    expect(listed.body.tasks).toHaveLength(1);
  });

  test("legacy message history never appears in the task collection", async () => {
    await api.call("/api/ingest/messages", "POST", {
      id: "legacy",
      sender: "Alice",
      text: "A message",
      received_at: "2026-11-03T12:00:00Z",
    });
    await api.call("/v1/tasks", "POST", { description: "A task" });

    const tasks = await api.call("/v1/tasks");
    const messages = await api.call("/v1/messages");

    expect(tasks.body.tasks).toHaveLength(1);
    expect(tasks.body.tasks[0].description).toBe("A task");
    expect(messages.body.messages[0].text).toBe("A message");
  });
});
