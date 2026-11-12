import { describe, expect, test } from "bun:test";
import { datesBetween, habitDay } from "../../src/habits/habit-day";

describe("habitDay", () => {
  test("a tick before 04:00 counts for the day before", () => {
    // 00:40 and 03:59 on 13 Nov in London are still the 12th; 04:00 is the 13th.
    expect(habitDay(new Date("2026-11-13T00:40:00Z"), "Europe/London")).toBe("2026-11-12");
    expect(habitDay(new Date("2026-11-13T03:59:00Z"), "Europe/London")).toBe("2026-11-12");
    expect(habitDay(new Date("2026-11-13T04:00:00Z"), "Europe/London")).toBe("2026-11-13");
  });

  test("follows the server's time zone, not the machine's", () => {
    // 05:00Z on 13 Nov is 21:00 on the 12th in Los Angeles.
    expect(habitDay(new Date("2026-11-13T05:00:00Z"), "America/Los_Angeles")).toBe("2026-11-12");
  });
});

describe("datesBetween", () => {
  test("lists each date across a month end, both ends included", () => {
    expect(datesBetween("2026-10-30", "2026-11-02")).toEqual([
      "2026-10-30",
      "2026-10-31",
      "2026-11-01",
      "2026-11-02",
    ]);
    expect(datesBetween("2026-11-02", "2026-11-01")).toEqual([]);
  });
});
