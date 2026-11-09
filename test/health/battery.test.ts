import { describe, expect, test } from "bun:test";
import { latestBattery } from "../../src/health/battery";

describe("latestBattery", () => {
  test("takes the newest row with a percent", () => {
    const rows = [
      { ts: 1000, pct: 30.8, charging: null },
      { ts: 2000, pct: 30.1, charging: 1 },
    ];

    expect(latestBattery(rows)).toEqual({ ts: 2000, percent: 30.1, charging: true });
  });

  test("leaves charging unknown until the strap reports a charger change", () => {
    expect(latestBattery([{ ts: 1000, pct: 6.4, charging: null }])?.charging).toBeNull();
  });

  test("skips rows from before the first percent", () => {
    expect(latestBattery([{ ts: 1000, pct: null, charging: 0 }])).toBeNull();
    expect(latestBattery([])).toBeNull();
  });
});
