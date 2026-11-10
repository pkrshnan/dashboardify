import { describe, expect, test } from "bun:test";
import { breathingRate } from "../../../src/health/metrics/breathing";
import {
  minuteHr,
  predictedMaxHr,
  restingHr,
  zoneMinutes,
} from "../../../src/health/metrics/heart-rate";
import {
  cleanRr,
  goodWindows,
  nightHrv,
  rmssd,
  successiveDiffs,
} from "../../../src/health/metrics/hrv";
import { recovery } from "../../../src/health/metrics/recovery";
import { sleepSkinTemp } from "../../../src/health/metrics/skin-temp";
import { sleepWindow } from "../../../src/health/metrics/sleep";
import { normalCdf, percentile } from "../../../src/health/metrics/stats";
import { stepsTaken } from "../../../src/health/metrics/steps";
import { strain, trimp } from "../../../src/health/metrics/strain";
import { dayMetrics, nightMetrics } from "../../../src/health/metrics/summary";
import { accelDay, breathingBeats, HOUR, heartRate, random, T0 } from "./fixtures";

const beatsFrom = (start: number, gaps: number[]) => {
  let t = start;
  return gaps.map((ms) => {
    t += ms;
    return { ts: t, ms };
  });
};

describe("stats", () => {
  test("percentile interpolates between ranks", () => {
    expect(percentile([1, 2, 3, 4, 5], 50)).toBe(3);
    expect(percentile([10, 20], 10)).toBe(11);
    expect(percentile([], 50)).toBeNull();
  });

  test("normalCdf matches the table", () => {
    expect(normalCdf(0)).toBeCloseTo(0.5, 6);
    expect(normalCdf(-1.05)).toBeCloseTo(0.1469, 3);
    expect(normalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
});

describe("HRV", () => {
  test("RMSSD of the doc's worked example is 40.3 ms", () => {
    const beats = cleanRr(beatsFrom(T0, [1000, 1040, 980, 1010, 990]));
    expect(rmssd(successiveDiffs(beats))).toBeCloseTo(40.31, 2);
  });

  test("cleaning drops a missed beat and doesn't join across it", () => {
    const beats = cleanRr(beatsFrom(T0, [1000, 1010, 2005, 995, 1000, 1005]));
    expect(beats.map((b) => b.kept)).toEqual([true, true, false, true, true, true]);
    // 1010 → 995 straddles the dropped gap, so it isn't a successive difference.
    expect(successiveDiffs(beats)).toEqual([10, 5, 5]);
  });

  test("drops gaps outside 300–2000 ms", () => {
    const beats = cleanRr(beatsFrom(T0, [1000, 250, 1000, 2500, 1000]));
    expect(beats.filter((b) => !b.kept)).toHaveLength(2);
  });

  test("night HRV is the median of 5-minute windows", () => {
    const beats = cleanRr(breathingBeats(T0, HOUR, { swing: 40 }));
    const hrv = nightHrv(beats, { start: T0, end: T0 + HOUR });
    expect(hrv?.windows).toBeGreaterThanOrEqual(11);
    // A sine of amplitude 40 at 15 breaths/min and 60 bpm: RMSSD ≈ 40·√2·sin(π/4) ≈ 40.
    expect(hrv?.rmssdMs).toBeGreaterThan(30);
    expect(hrv?.rmssdMs).toBeLessThan(50);
  });
});

describe("breathing rate", () => {
  test("finds the breathing rhythm in the beat gaps", () => {
    for (const breathsPerMin of [12, 15, 18]) {
      const beats = cleanRr(breathingBeats(T0, HOUR, { breathsPerMin }));
      const rate = breathingRate(goodWindows(beats, { start: T0, end: T0 + HOUR }));
      expect(rate).not.toBeNull();
      expect(Math.abs((rate ?? 0) - breathsPerMin)).toBeLessThan(0.5);
    }
  });

  test("no clear rhythm, no answer", () => {
    expect(breathingRate([])).toBeNull();
  });
});

describe("sleep window", () => {
  test("finds the still stretch overnight", () => {
    const sleep = { start: T0 + 5 * HOUR, end: T0 + 13 * HOUR };
    const window = sleepWindow(accelDay(T0, T0 + 20 * HOUR, sleep));
    expect(Math.abs((window?.start ?? 0) - sleep.start)).toBeLessThan(10 * 60_000);
    expect(Math.abs((window?.end ?? 0) - sleep.end)).toBeLessThan(10 * 60_000);
  });

  test("no data, no window", () => {
    expect(sleepWindow([])).toBeNull();
  });
});

describe("heart rate", () => {
  test("resting HR is the 10th percentile of 5-minute means", () => {
    // 100 minutes, each minute's HR = 50 + minute index / 10 (50.0 … 59.9).
    const samples = heartRate(
      T0,
      T0 + 100 * 60_000,
      (ts) => 50 + Math.floor((ts - T0) / 60_000) / 10,
    );
    expect(restingHr(minuteHr(samples))).toBeCloseTo(51.17, 1);
  });

  test("predicted max HR and zones", () => {
    expect(predictedMaxHr(30)).toBe(187);
    const minutes = [95, 115, 135, 155, 175, 195, 60].map((bpm, i) => ({ ts: i, bpm }));
    expect(zoneMinutes(minutes, 190)).toEqual([1, 1, 1, 1, 2]);
  });
});

describe("strain", () => {
  test("the doc's example: a 45-minute run and an hour's walk", () => {
    const minutes = [
      ...Array.from({ length: 45 }, (_, i) => ({ ts: i, bpm: 150 })),
      ...Array.from({ length: 60 }, (_, i) => ({ ts: 100 + i, bpm: 100 })),
      ...Array.from({ length: 600 }, (_, i) => ({ ts: 200 + i, bpm: 65 })),
    ];
    const total = trimp(minutes, 55, 190, "male");
    // The doc rounds each step and gets 101 and 13.4; unrounded it is 102.5 and 13.5.
    expect(total).toBeCloseTo(102.5, 0);
    expect(strain(total)).toBeCloseTo(13.5, 1);
  });
});

describe("steps", () => {
  test("handles counter wraps and resets", () => {
    const counts = [65_530, 65_535, 3, 10, 0, 4].map((count, i) => ({ ts: T0 + i * 2000, count }));
    // +5, +4 (wrap), +7, reset to 0 counts 0, +4
    expect(stepsTaken(counts)).toBe(20);
  });
});

describe("skin temperature", () => {
  test("median during sleep after 30 minutes settling", () => {
    const samples = [
      { ts: T0 + 10 * 60_000, celsius: 31 },
      { ts: T0 + 40 * 60_000, celsius: 34.2 },
      { ts: T0 + 50 * 60_000, celsius: 34.4 },
    ];
    expect(sleepSkinTemp(samples, { start: T0, end: T0 + HOUR })).toBeCloseTo(34.3, 5);
  });
});

describe("recovery", () => {
  const rand = random(11);
  const history = Array.from({ length: 30 }, () => ({
    sleepScore: null,
    lnRmssd: 3.8 + (rand() - 0.5) * 0.4,
    restingHr: 52 + (rand() - 0.5) * 5,
    breathingRate: 14 + (rand() - 0.5),
    skinTemp: 34.3 + (rand() - 0.5) * 0.3,
  }));

  test("needs two weeks of nights", () => {
    const night = {
      lnRmssd: 3.8,
      restingHr: 52,
      breathingRate: 14,
      skinTemp: 34.3,
      sleepScore: null,
    };
    expect(recovery(night, history.slice(0, 10))).toBeNull();
  });

  test("an ordinary night lands near 50%", () => {
    const night = {
      lnRmssd: 3.8,
      restingHr: 52,
      breathingRate: 14,
      skinTemp: 34.3,
      sleepScore: null,
    };
    const result = recovery(night, history);
    expect(result?.pct).toBeGreaterThan(35);
    expect(result?.pct).toBeLessThan(65);
  });

  test("low HRV and a raised resting HR is red", () => {
    const night = {
      lnRmssd: 3.6,
      restingHr: 56,
      breathingRate: 14,
      skinTemp: 34.3,
      sleepScore: null,
    };
    expect(recovery(night, history)?.pct).toBeLessThan(34);
  });

  test("a fever-like temperature pulls a good night down", () => {
    const good = {
      lnRmssd: 3.95,
      restingHr: 50,
      breathingRate: 14,
      skinTemp: 34.3,
      sleepScore: null,
    };
    const hot = { ...good, skinTemp: 35.3 };
    expect(recovery(hot, history)?.pct ?? 100).toBeLessThan(recovery(good, history)?.pct ?? 0);
  });
});

describe("summaries", () => {
  test("a night from raw streams", () => {
    const sleep = { start: T0 + 5 * HOUR, end: T0 + 13 * HOUR };
    const night = nightMetrics({
      accel: accelDay(T0, T0 + 20 * HOUR, sleep),
      heartRate: heartRate(T0, T0 + 20 * HOUR, (ts) =>
        ts >= sleep.start && ts < sleep.end ? 52 : 75,
      ),
      rr: breathingBeats(sleep.start, sleep.end - sleep.start, { base: 1150 }),
      skinTemp: [{ ts: sleep.start + HOUR, celsius: 34.5 }],
      past: [],
      needMin: 480,
      minutesAfterNoon: (ts) => Math.round((ts - T0) / 60_000) + 360,
    });
    expect(night?.inBedMin).toBeGreaterThan(460);
    expect(night?.restingHr).toBeCloseTo(52, 0);
    expect(night?.rmssdMs).toBeGreaterThan(20);
    expect(night?.breathingRate).toBeCloseTo(15, 0);
    expect(night?.skinTemp).toBe(34.5);
    expect(night?.asleepMin).toBeCloseTo(480, -1);
    expect(night?.sleep.score).toBeGreaterThan(99);
  });

  test("a day without a profile has no strain", () => {
    const day = dayMetrics({
      heartRate: heartRate(T0, T0 + HOUR, () => 120),
      steps: [],
      motion: [],
      sleep: null,
      restingHr: 55,
      profile: { ageYears: null, sex: null, maxHrMeasured: null, weightKg: null, heightCm: null },
    });
    expect(day.wornMin).toBe(60);
    expect(day.strain).toBeNull();
  });

  test("a day with a profile has strain and zones", () => {
    const day = dayMetrics({
      heartRate: heartRate(T0, T0 + HOUR, () => 150),
      steps: [],
      motion: [],
      sleep: null,
      restingHr: 55,
      profile: { ageYears: 30, sex: "male", maxHrMeasured: 190, weightKg: null, heightCm: null },
    });
    expect(day.strain).toBeGreaterThan(10);
    expect(day.zoneMin).toEqual([0, 0, 60, 0, 0]);
  });
});
