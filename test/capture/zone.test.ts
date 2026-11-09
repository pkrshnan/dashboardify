import { describe, expect, test } from "bun:test";
import { instantAt, offsetMinutes, wallClock } from "../../src/capture/zone";

describe("offsetMinutes", () => {
  test("follows daylight saving", () => {
    expect(offsetMinutes(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(60);
    expect(offsetMinutes(new Date("2026-12-01T12:00:00Z"), "Europe/London")).toBe(0);
    expect(offsetMinutes(new Date("2026-12-01T12:00:00Z"), "America/Los_Angeles")).toBe(-480);
  });
});

describe("instantAt", () => {
  test("round-trips with wallClock", () => {
    const clock = { year: 2026, month: 7, day: 1, hour: 9, minute: 15 };

    const at = instantAt(clock, "Europe/London");

    expect(at.toISOString()).toBe("2026-07-01T08:15:00.000Z");
    expect(wallClock(at, "Europe/London")).toEqual(clock);
  });

  test("a time skipped when the clocks go forward moves on by the jump", () => {
    const skipped = { year: 2026, month: 3, day: 8, hour: 2, minute: 30 };

    expect(instantAt(skipped, "America/Los_Angeles").toISOString()).toBe(
      "2026-03-08T10:30:00.000Z",
    );
  });

  test("a time repeated when the clocks go back takes the first", () => {
    const repeated = { year: 2026, month: 10, day: 25, hour: 1, minute: 30 };

    expect(instantAt(repeated, "Europe/London").toISOString()).toBe("2026-10-25T00:30:00.000Z");
  });
});
