import { describe, expect, test } from "bun:test";
import type { NightView } from "../../web/api";
import { hourTicks, stageTotals } from "../../web/lib/night";

const night = (more: Partial<NightView> = {}): NightView => ({
  name: "days/2026-11-03/night",
  bed: 0,
  onset: 0,
  wake: 0,
  asleepMin: 432,
  sleepScore: 84,
  lightMin: 247,
  deepMin: 85,
  remMin: 100,
  stagesPlausible: true,
  stages: [],
  ...more,
});

describe("night view", () => {
  test("stage totals read deep, REM, then light", () => {
    expect(stageTotals(night())).toBe("Deep 1h 25m · REM 1h 40m · Light 4h 07m");
  });

  test("a night without stages has no totals", () => {
    expect(stageTotals(night({ deepMin: null }))).toBeNull();
  });

  test("hour ticks fall on the zone's whole hours, even half an hour off UTC", () => {
    const bed = Date.parse("2026-11-02T18:11:00Z"); // 23:41 in Kolkata
    const wake = Date.parse("2026-11-03T01:35:00Z"); // 07:05

    const ticks = hourTicks(bed, wake, "Asia/Kolkata");

    expect(ticks[0]).toBe(Date.parse("2026-11-02T18:30:00Z"));
    expect(ticks).toHaveLength(8);
  });

  test("a bedtime on the hour is its own first tick", () => {
    const bed = Date.parse("2026-11-02T23:00:00Z");

    expect(hourTicks(bed, bed + 2 * 3_600_000, "Europe/London")).toEqual([
      bed,
      bed + 3_600_000,
      bed + 7_200_000,
    ]);
  });
});
