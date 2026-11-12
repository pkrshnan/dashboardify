// docs/health-primer.html explains every health number with a worked example. These tests work
// the same examples with the real functions, so a changed constant or formula fails here until
// the primer says the new number. See docs/development.md#health-primer.

import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { bmr, keytelKcal, minuteKcal, walkingKcal } from "../../src/health/metrics/calories";
import { dfaAlpha1 } from "../../src/health/metrics/dfa";
import { rmssd } from "../../src/health/metrics/hrv";
import { loadBand, trainingLoad } from "../../src/health/metrics/load";
import { recoveryTerms } from "../../src/health/metrics/recovery";
import { sleepScore } from "../../src/health/metrics/sleep-score";
import {
  DEFAULT_EMISSIONS,
  FITTED_FEATURES,
  gaussian,
  type SleepStage,
  STAGE_PARAMS,
} from "../../src/health/metrics/sleep-stages";
import { normalCdf } from "../../src/health/metrics/stats";
import { minuteTrimp, reserve, strain } from "../../src/health/metrics/strain";
import { vo2max } from "../../src/health/metrics/vo2max";
import { DEFAULT_PARAMS, WEIGHT_KEYS } from "../../src/health/params";

const ROOT = join(import.meta.dir, "../..");
const PRIMER = readFileSync(join(ROOT, "docs/health-primer.html"), "utf8");

/** The primer's example person. */
const BODY = { weightKg: 70, heightCm: 175, ageYears: 30, sex: "male" as const };
const PERSON = { restingHr: 52, maxHr: 190, body: BODY };

/** The text of one worked example, tags removed. */
function example(id: string): string {
  const match = new RegExp(`<div class="ex" id="ex-${id}">([\\s\\S]*?)\n</div>`).exec(PRIMER);
  return (match?.[1] ?? "").replace(/<[^>]+>/g, "");
}

/** A number as the primer prints it: thousands commas and a real minus sign. */
function shown(value: number | null, digits: number, signed = false): string {
  const n = value ?? Number.NaN;
  const text = Math.abs(n).toLocaleString("en-GB", {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  });
  if (n < 0) {
    return `−${text}`;
  }
  return signed ? `+${text}` : text;
}

function expectShown(id: string, values: string[]): void {
  const text = example(id);
  for (const value of values) {
    expect(text).toContain(value);
  }
}

describe("health primer", () => {
  test("names every metrics file", () => {
    const helpers = ["stats.ts", "summary.ts", "types.ts"];
    const files = readdirSync(join(ROOT, "src/health/metrics")).filter(
      (name) => name.endsWith(".ts") && !helpers.includes(name),
    );
    const named = [...PRIMER.matchAll(/<p class="file">(.*?)<\/p>/g)].map((m) => m[1]).join(" ");

    expect(files.filter((name) => !named.includes(name))).toEqual([]);
  });

  test("gives every worked example an id", () => {
    expect(PRIMER).not.toContain('<div class="ex">');
  });

  test("sleep stages: one epoch's log scores", () => {
    const z = { hrZ: 0.9, hrvZ: -0.5, breathingZ: -0.7, dfaZ: 0.6 };
    const total = (stage: SleepStage) =>
      gaussian(z.hrZ, STAGE_PARAMS.hr[stage].mean, STAGE_PARAMS.hr[stage].sd) +
      FITTED_FEATURES.reduce((sum, k) => {
        const own = DEFAULT_EMISSIONS[stage][k];
        return sum + gaussian(z[k], own.mean, own.sd);
      }, 0);

    expectShown("stages", [
      shown(total("light"), 2, true),
      shown(total("deep"), 2, true),
      shown(total("rem"), 2, true),
      shown(total("rem") - total("light"), 2),
    ]);
  });

  test("DFA α1: independent gaps and a drift", () => {
    // The same small generator the example's numbers came from.
    let seed = 7;
    const random = () => {
      seed = (seed * 1103515245 + 12345) % 2147483648;
      return seed / 2147483648;
    };
    const normal = () =>
      Math.sqrt(-2 * Math.log(random() + 1e-12)) * Math.cos(2 * Math.PI * random());
    const independent = Array.from({ length: 300 }, () => 1000 + 30 * normal());
    let drift = 0;
    const walk = Array.from({ length: 300 }, () => {
      drift += 10 * normal();
      return 1000 + drift;
    });

    expectShown("dfa", [shown(dfaAlpha1(independent), 2), shown(dfaAlpha1(walk), 2)]);
  });

  test("sleep score", () => {
    const night = (asleepMin: number) => ({ asleepMin, onsetMin: 690, wakeMin: 1140 });
    const past = [night(480), night(450), night(420), night(480)];
    const score = sleepScore(
      { asleepMin: 410, efficiency: 410 / 462, onsetMin: 710, wakeMin: 1160 },
      past,
    );

    expectShown("score", [
      `${shown(score.needMin, 0)} min`,
      shown(score.sufficiency, 1),
      shown(score.efficiencyScore, 1),
      shown(score.consistency, 1),
      shown(score.score, 1),
    ]);
  });

  test("HRV", () => {
    const value = rmssd([40, -60, 30, -20]);

    expectShown("hrv", [`${shown(value, 1)} ms`, shown(Math.log(value ?? 1), 2)]);
  });

  test("recovery: a good night and a bad one", () => {
    const base = {
      hrv: { mean: 3.7, sd: 0.2 },
      rhr: { mean: 52, sd: 2 },
      sleep: { mean: 77, sd: 8 },
      breathing: { mean: 15, sd: 1 },
    };
    const combined = (lnRmssd: number, restingHr: number, sleep: number, breathingRate: number) => {
      const terms = recoveryTerms(
        { lnRmssd, restingHr, sleepScore: sleep, breathingRate, skinTemp: null },
        base,
      );
      return WEIGHT_KEYS.reduce(
        (sum, k) => sum + DEFAULT_PARAMS.recovery[k] * (terms?.[k] ?? 0),
        0,
      );
    };
    // The example's spread of c, and 0.5 per °C past +0.3 for the bad night's +0.7 °C.
    const spread = 0.55;
    const good = combined(3.8, 51.2, 80, 15.4);
    const bad = combined(3.46, 54, 69, 16.8) - 0.5 * (0.7 - 0.3);

    expectShown("recovery", [
      shown(good, 3),
      `Recovery = ${shown(100 * normalCdf(good / spread), 0)}%`,
      shown(bad, 2),
      `Recovery = ${shown(100 * normalCdf(bad / spread), 0)}%`,
    ]);
  });

  test("strain", () => {
    const minute = (bpm: number) => minuteTrimp(reserve(bpm, 52, 190), "male");
    const day = 45 * minute(150) + 40 * minute(100);

    expect(minute(80)).toBe(0);
    expectShown("strain", [
      shown(minute(150), 2),
      shown(minute(100), 2),
      shown(day, 1),
      `Strain = 21 × (1 − e^(−${shown(day / 100, 3)})) = ${shown(strain(day), 1)}`,
    ]);
  });

  test("training load", () => {
    const week = (trimp: number) =>
      trainingLoad(
        [
          ...Array(49).fill({ trimp: 60, wornMin: 1400 }),
          ...Array(7).fill({ trimp, wornMin: 1400 }),
        ],
        false,
      );
    const row = (load: ReturnType<typeof week>) =>
      `${shown(load.acute, 1)} ÷ ${shown(load.chronic, 1)}`;
    const band = (load: ReturnType<typeof week>) =>
      `${shown(load.ratio, 2)}   →  ${loadBand(load.ratio ?? 0)}`;

    expectShown("load", [row(week(100)), band(week(100)), row(week(130)), band(week(130))]);
  });

  test("calories", () => {
    const day = bmr(BODY);
    const base = day / 1440;
    const run = minuteKcal({ bpm: 150, steps: 160 }, false, PERSON);
    const walk = minuteKcal({ bpm: 100, steps: 110 }, false, PERSON);
    const sitting = minuteKcal({ bpm: 70, steps: 0 }, false, PERSON);
    const total = 450 * base * 0.95 + 45 * run + 40 * walk + 905 * sitting;

    expect(walk).toBe(walkingKcal(110, BODY));
    expect(run).toBe(keytelKcal(150, BODY));
    expectShown("calories", [
      `${shown(day, 0)} kcal/day`,
      `per minute ${shown(base, 3)}`,
      `asleep ${shown(base * 0.95, 3)}`,
      `sitting ${shown(sitting, 3)}`,
      `minute        ${shown(walk, 2)} kcal`,
      `minute   ${shown(run, 2)} kcal`,
      `Keytel ${shown(keytelKcal(114, BODY), 2)}`,
      `= ${shown(minuteKcal({ bpm: 114, steps: 0 }, false, PERSON), 2)} kcal`,
      `${shown(total, 0)} kcal`,
      `${shown(total - day, 0)} kcal`,
    ]);
  });

  test("VO2max", () => {
    const at = (restingHr: number) =>
      shown(vo2max({ maxHrMeasured: 190, sex: "male", restingHrs: Array(30).fill(restingHr) }), 1);

    expectShown("vo2max", [`= ${at(52)}`, `60    ${at(60)}`, `45    ${at(45)}`]);
  });
});
