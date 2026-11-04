import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("journal API", () => {
  const api = useApi();

  test("journal retries return the original entry after another write", async () => {
    const path = "/v1/days/2026-11-03/journalEntries";

    const first = await api.call(`${path}?requestId=first`, "POST", { text: "first" });
    await api.call(path, "POST", { text: "second" });
    const retry = await api.call(`${path}?requestId=first`, "POST", { text: "first" });

    expect(retry.body).toEqual(first.body);
    expect((await api.call(path)).body.journalEntries).toHaveLength(2);
  });
});

describe("journal text", () => {
  const api = useApi();

  test("preserves multiline entries", async () => {
    const path = "/v1/days/2026-11-03/journalEntries";

    const created = await api.call(path, "POST", { text: "Hello\nworld" });
    const listed = await api.call(path);

    expect(created.status).toBe(200);
    expect(listed.body.journalEntries[0].text).toBe("Hello\nworld");
  });
});
