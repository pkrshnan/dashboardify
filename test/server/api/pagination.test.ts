import { describe, expect, test } from "bun:test";
import { paginate } from "../../../src/server/api/pagination";

describe("pagination", () => {
  test("continues from a returned token without repeating rows", () => {
    const first = paginate(["a", "b", "c"], { pageSize: 2 });
    const last = paginate(["a", "b", "c"], { pageSize: 2, pageToken: first.nextPageToken });

    expect(first.items).toEqual(["a", "b"]);
    expect(last).toEqual({ items: ["c"], nextPageToken: "" });
  });

  test("caps large pages and rejects unusable offsets", () => {
    expect(
      paginate(
        Array.from({ length: 600 }, (_, index) => index),
        { pageSize: 1000 },
      ).items,
    ).toHaveLength(500);
    expect(() => paginate([], { pageToken: "not-an-offset" })).toThrow("invalid page token");
    expect(() => paginate([], { pageSize: -1 })).toThrow("invalid page size");
  });
});
