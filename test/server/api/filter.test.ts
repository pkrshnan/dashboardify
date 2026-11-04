import { describe, expect, test } from "bun:test";
import { filterItems } from "../../../src/server/api/filter";

describe("API filters", () => {
  const rows = [
    { state: "STATE_OPEN", due_date: "2026-11-03" },
    { state: "STATE_DONE", due_date: "2026-11-02" },
    { state: "STATE_OPEN" },
  ];

  test("combines comparisons and excludes missing values from date comparisons", () => {
    const filtered = filterItems(rows, 'state = STATE_OPEN AND due_date < "2026-11-04"', [
      "state",
      "due_date",
    ]);

    expect(filtered).toEqual([{ state: "STATE_OPEN", due_date: "2026-11-03" }]);
    expect(rows).toHaveLength(3);
  });

  test("rejects unsupported fields and expressions instead of ignoring them", () => {
    expect(() => filterItems(rows, 'sender = "Alice"', ["state"])).toThrow("unsupported filter");
    expect(() => filterItems(rows, "state = STATE_OPEN OR state = STATE_DONE", ["state"])).toThrow(
      "unsupported filter",
    );
  });
});
