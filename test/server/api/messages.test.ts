import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("messages API", () => {
  const api = useApi();

  test("rejects a duplicate message id and returns stored history", async () => {
    const message = { sender: "Alice", text: "Hello", receiveTime: "2026-11-03T12:00:00Z" };

    const created = await api.call("/v1/messages?messageId=one", "POST", message);
    const duplicate = await api.call("/v1/messages?messageId=one", "POST", message);
    const listed = await api.call("/v1/messages");

    expect(created.status).toBe(200);
    expect(duplicate.status).toBe(409);
    expect(listed.body.messages).toHaveLength(1);
    expect(listed.body.messages[0].name).toBe("messages/one");
  });
});
