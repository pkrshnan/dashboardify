import { expect, test } from "bun:test";
import { parseProfile } from "../../src/health/profile";

test("reads age on the day, sex and measured max HR", () => {
  const profile = parseProfile(
    { birth_date: "1996-05-01", sex: "M", hr_max_measured: 192 },
    "2026-04-30",
  );
  expect(profile).toEqual({ ageYears: 29, sex: "male", maxHrMeasured: 192 });
  expect(parseProfile({ birth_date: "1996-05-01" }, "2026-05-01").ageYears).toBe(30);
});

test("missing or odd fields are null", () => {
  expect(parseProfile(null, "2026-11-02")).toEqual({
    ageYears: null,
    sex: null,
    maxHrMeasured: null,
  });
  expect(parseProfile({ birth_date: "soon", sex: "x" }, "2026-11-02").ageYears).toBeNull();
});
