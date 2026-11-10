import { describe, expect, test } from "bun:test";
import { fitnessAge } from "../../../src/health/metrics/age";
import { vo2max } from "../../../src/health/metrics/vo2max";

describe("fitnessAge", () => {
  test("is a decade's midpoint at that decade's HUNT3 mean", () => {
    expect(fitnessAge(54.4, "male")).toBe(25);
    expect(fitnessAge(42.6, "male")).toBe(55);
    expect(fitnessAge(43.0, "female")).toBe(25);
    expect(fitnessAge(31.1, "female")).toBe(65);
  });

  test("reads between decades on a straight line", () => {
    // Halfway from the women's 40s mean (38.4) to their 50s (34.4).
    expect(fitnessAge(36.4, "female")).toBe(50);
    // A woman's VO2max reads younger than the same number for a man.
    expect(fitnessAge(40, "female")).toBe(35);
    expect(fitnessAge(40, "male")).toBe(63);
  });

  test("the user's own numbers: a man with max 205 and resting 55 is 20", () => {
    const value = vo2max({ maxHrMeasured: 205, sex: "male", restingHrs: Array(30).fill(55) });

    // 57.0 is above the men's 20s mean, so it runs on along the 20s-to-30s slope: 20.04.
    expect(fitnessAge(value, "male")).toBe(20);
  });

  test("runs on past the end decades, then holds to the study's 20–90", () => {
    // 3 below the women's 70+ mean on their 60s-to-70+ slope (0.28 a year) is about 86.
    expect(fitnessAge(25.3, "female")).toBe(86);
    expect(fitnessAge(70, "male")).toBe(20);
    expect(fitnessAge(15, "male")).toBe(90);
    expect(fitnessAge(10, "female")).toBe(90);
  });

  test("no VO2max or sex, no fitness age", () => {
    expect(fitnessAge(null, "male")).toBeNull();
    expect(fitnessAge(50, null)).toBeNull();
  });
});
