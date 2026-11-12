import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DerivedStore } from "../../src/health/derived-store";
import { EXTENDED_METRICS, HealthHistory, lastDays, METRICS } from "../../src/home/health-history";

const TODAY = "2026-11-03";
let dir: string;
let derived: DerivedStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "health-history-"));
  derived = new DerivedStore(dir);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** 70 days: steady before the last week, which moves every number. */
async function seed() {
  for (const [i, date] of lastDays(TODAY, 70).entries()) {
    const at = (before: number, lastWeek: number, wobble: number) =>
      (i >= 63 ? lastWeek : before) + (i % 2) * wobble;
    await derived.write("days", date, {
      vo2max: at(44, 48, 1),
      load_ratio: at(1, 1.4, 0.1),
      kcal: at(2400, 2900, 50),
    });
    await derived.write("nights", date, { deep_min: at(80, 100, 4), rem_min: at(90, 70, 4) });
  }
}

const byKey = async () => {
  const trends = await new HealthHistory(derived).trends(TODAY, EXTENDED_METRICS);
  return new Map(trends.map((t) => [t.key, t]));
};

describe("extended health trends", () => {
  test("are grouped in the design's order and kept off the home list", () => {
    const groups = EXTENDED_METRICS.map((m) => m.group);
    const homeKeys = new Set(METRICS.map((m) => m.key));

    expect(groups).toEqual(["heart", "sleep", "sleep", "activity", "activity"]);
    expect(EXTENDED_METRICS.filter((m) => homeKeys.has(m.key))).toEqual([]);
  });

  test("VO2max, deep and REM are coloured by which way is good", async () => {
    await seed();

    const trends = await byKey();

    expect(trends.get("vo2max")).toMatchObject({ value: "49.0", tone: "good", partial: false });
    expect(trends.get("deep")).toMatchObject({ value: "1h 44m", tone: "good" });
    expect(trends.get("rem")).toMatchObject({ value: "1h 14m", tone: "bad" });
  });

  test("training load and calories are always grey", async () => {
    await seed();

    const trends = await byKey();

    expect(trends.get("loadRatio")).toMatchObject({ value: "1.5", tone: "neutral" });
    expect(trends.get("loadRatio")?.delta).toMatch(/^\+/);
    expect(trends.get("calories")).toMatchObject({ tone: "neutral", partial: true });
  });

  test("calories show today so far beside yesterday's total", async () => {
    await seed();
    await derived.write("days", TODAY, { kcal: 900 });

    const calories = (await byKey()).get("calories");

    expect(calories?.value).toBe("900");
    expect(calories?.yesterdayValue).toBe("2,900");
    expect(calories?.tone).toBe("neutral");
  });
});
