import { describe, expect, test } from "bun:test";
import { useApi } from "./helpers";

describe("home API", () => {
  const api = useApi();

  test("returns the computed home resource with protobuf date fields", async () => {
    const response = await api.call("/v1/home");

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("home");
    expect(response.body.date).toEqual({ year: 2026, month: 11, day: 3 });
    expect(response.body.timeZone).toBe("UTC");
    expect(response.body.generateTime).toBe("2026-11-03T12:00:00Z");
  });
});
