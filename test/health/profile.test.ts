import { expect, test } from "bun:test";
import { parseProfile } from "../../src/health/profile";

test("reads age on the day, sex, measured max HR, weight and height", () => {
  const profile = parseProfile(
    { birth_date: "1996-05-01", sex: "M", hr_max_measured: 192, weight_kg: 72.5, height_cm: 178 },
    "2026-04-30",
  );
  expect(profile).toEqual({
    ageYears: 29,
    sex: "male",
    maxHrMeasured: 192,
    weightKg: 72.5,
    heightCm: 178,
  });
  expect(parseProfile({ birth_date: "1996-05-01" }, "2026-05-01").ageYears).toBe(30);
});

test("missing or odd fields are null", () => {
  expect(parseProfile(null, "2026-11-02")).toEqual({
    ageYears: null,
    sex: null,
    maxHrMeasured: null,
    weightKg: null,
    heightCm: null,
  });
  expect(parseProfile({ birth_date: "soon", sex: "x" }, "2026-11-02").ageYears).toBeNull();
});

test("weight or height that is a string, not positive or in the wrong unit is null", () => {
  for (const [weightKg, heightCm] of [
    [0, 0],
    [-72, -178],
    [20, 1.78],
    [450, 600],
    ["72", "178"],
  ]) {
    const profile = parseProfile({ weight_kg: weightKg, height_cm: heightCm }, "2026-11-02");
    expect(profile.weightKg).toBeNull();
    expect(profile.heightCm).toBeNull();
  }
});
