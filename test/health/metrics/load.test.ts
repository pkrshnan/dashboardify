import { describe, expect, test } from "bun:test";
import { type LoadDay, loadBand, trainingLoad } from "../../../src/health/metrics/load";

const worn = (trimp: number): LoadDay => ({ trimp, wornMin: 24 * 60 });
const days = (count: number, trimp: number): LoadDay[] =>
  Array.from({ length: count }, () => worn(trimp));

describe("trainingLoad", () => {
  test("a steady load is a ratio of 1", () => {
    expect(trainingLoad(days(28, 100), false)).toEqual({ acute: 100, chronic: 100, ratio: 1 });
  });

  test("acute is an exponentially weighted mean, seeded with the first day", () => {
    const load = trainingLoad([worn(70), ...days(6, 0)], false);

    // λ = 2 / 8, so each later day keeps three quarters of the first.
    expect(load.acute).toBeCloseTo(70 * 0.75 ** 6, 6);
    expect(load.chronic).toBeNull();
    expect(load.ratio).toBeNull();
  });

  test("a harder week raises acute faster than chronic", () => {
    const load = trainingLoad([...days(28, 100), ...days(7, 200)], false);

    const acute = 200 - 100 * 0.75 ** 7;
    const chronic = 200 - 100 * (27 / 29) ** 7;
    expect(load.acute).toBeCloseTo(acute, 6);
    expect(load.chronic).toBeCloseTo(chronic, 6);
    expect(load.ratio).toBeCloseTo(acute / chronic, 6);
  });

  test("a missing or barely worn day gets the median of the well-worn days", () => {
    const series = [...days(14, 100), null, { trimp: 5, wornMin: 600 }, ...days(12, 100)];

    expect(trainingLoad(series, false)).toEqual({ acute: 100, chronic: 100, ratio: 1 });
  });

  test("a day with no TRIMP is a gap too", () => {
    const series = [...days(27, 100), { trimp: null, wornMin: 24 * 60 }];

    expect(trainingLoad(series, false).acute).toBe(100);
  });

  test("more than 2 gaps in the last 7 days leaves no acute or ratio", () => {
    const series = [...days(25, 100), null, null, ...days(2, 100), null];

    const load = trainingLoad(series, false);

    expect(load.acute).toBeNull();
    expect(load.ratio).toBeNull();
    expect(load.chronic).toBe(100);
  });

  test("2 gaps in the last 7 days still give a ratio", () => {
    const series = [...days(25, 100), null, ...days(3, 100), null];

    expect(trainingLoad(series, false).ratio).toBe(1);
  });

  test("under 28 days of history gives no chronic or ratio; days before it aren't gaps", () => {
    const before = Array.from({ length: 29 }, () => null);

    const short = trainingLoad([...before, ...days(27, 100)], false);
    const enough = trainingLoad([...before, ...days(28, 100)], false);

    expect(short).toEqual({ acute: 100, chronic: null, ratio: null });
    expect(enough.ratio).toBe(1);
  });

  test("no well-worn days means no load", () => {
    const barely = Array.from({ length: 30 }, () => ({ trimp: 80, wornMin: 600 }));

    expect(trainingLoad(barely, false)).toEqual({ acute: null, chronic: null, ratio: null });
    expect(trainingLoad([], false)).toEqual({ acute: null, chronic: null, ratio: null });
  });

  test("today counts as at least a typical day until it ends", () => {
    const morning = trainingLoad([...days(28, 100), { trimp: 10, wornMin: 400 }], true);
    const afterRun = trainingLoad([...days(28, 100), { trimp: 300, wornMin: 600 }], true);
    const ended = trainingLoad([...days(28, 100), worn(10)], false);

    expect(morning.ratio).toBe(1);
    expect(afterRun.acute).toBeCloseTo(0.75 * 100 + 0.25 * 300, 6);
    expect(ended.acute).toBeCloseTo(0.75 * 100 + 0.25 * 10, 6);
  });

  test("today's few hours worn are not a gap", () => {
    const series = [...days(24, 100), null, null, ...days(4, 100), { trimp: 0, wornMin: 300 }];

    expect(trainingLoad(series, true).acute).toBe(100);
    expect(trainingLoad(series, false).acute).toBeNull();
  });
});

describe("loadBand", () => {
  test.each([
    [0.79, "easing off"],
    [0.8, "steady"],
    [1.3, "steady"],
    [1.31, "building fast"],
    [1.5, "building fast"],
    [1.51, "spike"],
  ] as const)("%p is %p", (ratio, band) => {
    expect(loadBand(ratio)).toBe(band);
  });
});
