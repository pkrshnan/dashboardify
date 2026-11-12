// Reads the bits of profile.md (vault root) that the metrics need. Every field is optional:
// without them the metrics that need them are left out rather than guessed.

import type { Sex } from "./metrics/strain";
import type { Profile } from "./metrics/summary";

/** The profile as of `date` (YYYY-MM-DD): age is computed for that day. */
export function parseProfile(frontmatter: Record<string, unknown> | null, date: string): Profile {
  const fields = frontmatter ?? {};
  return {
    ageYears: ageOn(fields.birth_date, date),
    sex: parseSex(fields.sex),
    maxHrMeasured: typeof fields.hr_max_measured === "number" ? fields.hr_max_measured : null,
    weightKg: inRange(fields.weight_kg, WEIGHT_KG),
    heightCm: inRange(fields.height_cm, HEIGHT_CM),
  };
}

// Wide enough for any adult, narrow enough to catch a typo or height in metres or inches. A
// value outside is treated as missing, so calories are left out rather than wrong.
const WEIGHT_KG = { min: 30, max: 300 };
const HEIGHT_CM = { min: 120, max: 230 };

function inRange(value: unknown, range: { min: number; max: number }): number | null {
  return typeof value === "number" && value >= range.min && value <= range.max ? value : null;
}

function ageOn(birthDate: unknown, date: string): number | null {
  if (typeof birthDate !== "string" && !(birthDate instanceof Date)) {
    return null;
  }
  try {
    const born = Temporal.PlainDate.from(
      birthDate instanceof Date ? birthDate.toISOString().slice(0, 10) : birthDate,
    );
    return born.until(Temporal.PlainDate.from(date), { largestUnit: "years" }).years;
  } catch {
    return null;
  }
}

function parseSex(value: unknown): Sex | null {
  const text = typeof value === "string" ? value.trim().toLowerCase() : "";
  if (text === "male" || text === "m") {
    return "male";
  }
  if (text === "female" || text === "f") {
    return "female";
  }
  return null;
}
