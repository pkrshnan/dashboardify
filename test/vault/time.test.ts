import { expect, test } from "bun:test";
import { isIsoDate, localDate, localTime } from "../../src/vault/time";

test("local date and time follow the time zone", () => {
  const at = new Date("2026-11-02T06:30:00Z");
  expect(localDate(at, "America/Los_Angeles")).toBe("2026-11-01");
  expect(localTime(at, "America/Los_Angeles")).toBe("22:30");
  expect(localDate(at, "Asia/Kolkata")).toBe("2026-11-02");
  expect(localTime(at, "Asia/Kolkata")).toBe("12:00");
});

test("isIsoDate rejects impossible and malformed dates", () => {
  expect(isIsoDate("2026-11-02")).toBe(true);
  expect(isIsoDate("2028-02-29")).toBe(true);
  expect(isIsoDate("2026-02-29")).toBe(false);
  expect(isIsoDate("2026-13-01")).toBe(false);
  expect(isIsoDate("2026-1-1")).toBe(false);
  expect(isIsoDate(20261102)).toBe(false);
});
