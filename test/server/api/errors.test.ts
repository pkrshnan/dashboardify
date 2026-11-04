import { describe, expect, test } from "bun:test";
import { ApiError, invalidArgument } from "../../../src/server/api/errors";

describe("API errors", () => {
  test("retains the status and safe client message for either transport", () => {
    const error = new ApiError(409, "stale etag");

    expect(error.status).toBe(409);
    expect(error.message).toBe("stale etag");
    expect(() => invalidArgument("invalid day")).toThrow(ApiError);
  });
});
