import { describe, expect, test } from "bun:test";
import { requestedFields } from "../../../src/server/api/update-mask";

describe("update masks", () => {
  const writable = ["description", "dueDate"];

  test("an omitted mask changes only supplied writable fields", () => {
    expect(requestedFields({}, { description: "Task", etag: "hash" }, writable)).toEqual([
      "description",
    ]);
  });

  test("normalizes snake case and preserves explicitly masked clearing", () => {
    expect(requestedFields({ updateMask: "due_date" }, {}, writable)).toEqual(["dueDate"]);
    expect(requestedFields({ updateMask: "*" }, {}, writable)).toEqual(writable);
  });

  test("rejects unsupported and output-only fields", () => {
    expect(() => requestedFields({ updateMask: "state" }, {}, writable)).toThrow(
      "invalid update mask",
    );
  });
});
