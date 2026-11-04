import { describe, expect, test } from "bun:test";
import {
  fromDateParts,
  fromTimeParts,
  toDateParts,
  toTimeParts,
} from "../../../src/server/api/date-time";

describe("API date and time conversion", () => {
  test("round-trips leap days and rejects impossible dates", () => {
    const date = toDateParts("2024-02-29");

    expect(fromDateParts(date)).toBe("2024-02-29");
    expect(() => fromDateParts({ year: 2026, month: 2, day: 29 })).toThrow("invalid date");
  });

  test("preserves midnight and rejects time precision the vault cannot store", () => {
    expect(fromTimeParts({})).toBe("00:00");
    expect(toTimeParts("23:59")).toEqual({ hours: 23, minutes: 59 });
    expect(() => fromTimeParts({ hours: 24 })).toThrow("invalid time");
    expect(() => fromTimeParts({ seconds: 1 })).toThrow("invalid time");
  });
});
