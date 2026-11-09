import { describe, expect, test } from "bun:test";
import type { AgendaEvent, MetricTrend, Reminder } from "../../src/home/types";
import { chartShape, rangeLabel, rollingMeans, weeklyMeans } from "../../web/lib/chart";
import { nowIn } from "../../web/lib/clock";
import { dateSpan, longDate, startsIn } from "../../web/lib/format";
import { assignLanes, hourRange, layoutBlocks, layoutPills } from "../../web/lib/timeline";

function ev(startMin: number, endMin: number, title = "e"): AgendaEvent {
  return {
    title,
    start: "",
    end: "",
    startMin,
    endMin,
    detail: "",
    category: "work",
    url: null,
    mapsUrl: null,
    event: null,
    calendar: null,
    writable: false,
    allDay: false,
  };
}

function rem(minutes: number, id = String(minutes)): Reminder {
  return { id, text: id, time: "", minutes, done: false };
}

describe("timeline", () => {
  test("runs from an hour before now to 22:00, or later when needed", () => {
    expect(hourRange(9 * 60 + 12, [], [])).toEqual({ startHour: 8, endHour: 22 });
    expect(hourRange(9 * 60, [ev(21 * 60, 23 * 60)], [])).toEqual({ startHour: 8, endHour: 23 });
    expect(hourRange(23 * 60 + 30, [], [])).toEqual({ startHour: 20, endHour: 23 });
    expect(hourRange(30, [], [])).toEqual({ startHour: 0, endHour: 22 });
  });

  test("blocks: position, past, next, and one-line for short events", () => {
    const range = { startHour: 8, endHour: 22 };
    const blocks = layoutBlocks(
      [ev(7 * 60, 8 * 60 + 30), ev(10 * 60, 10 * 60 + 15), ev(14 * 60, 15 * 60)],
      range,
      52,
      9 * 60,
    );
    expect(blocks.map((b) => [b.top, b.past, b.next, b.oneLine])).toEqual([
      [0, true, false, true],
      [104, false, true, true],
      [312, false, false, false],
    ]);
  });

  test("overlapping events share the width", () => {
    const spans = [
      { start: 600, end: 660 },
      { start: 630, end: 700 },
      { start: 700, end: 760 },
    ];
    expect(assignLanes(spans)).toEqual([
      { lane: 0, lanes: 2 },
      { lane: 1, lanes: 2 },
      { lane: 0, lanes: 1 },
    ]);
  });

  test("back-to-back short events stretched to the minimum height don't cover each other", () => {
    const range = { startHour: 8, endHour: 22 };
    const blocks = layoutBlocks([ev(600, 615), ev(615, 630), ev(630, 645)], range, 52, 0);
    expect(blocks.map((b) => [b.lane, b.lanes])).toEqual([
      [0, 2],
      [1, 2],
      [0, 2],
    ]);
    const hourLong = layoutBlocks([ev(600, 660), ev(660, 720)], range, 52, 0);
    expect(hourLong.map((b) => [b.lane, b.lanes])).toEqual([
      [0, 1],
      [0, 1],
    ]);
  });

  test("reminder pills are pushed apart so they never overlap", () => {
    const pills = layoutPills(
      [rem(600), rem(605), rem(900)],
      { startHour: 8, endHour: 22 },
      52,
      32,
    );
    expect(pills.map((p) => [Math.round(p.lineTop), p.top])).toEqual([
      [104, 104],
      [108, 140],
      [364, 364],
    ]);
  });
});

function metric(
  values: (number | null)[],
  baseline: MetricTrend["baseline"],
  partial = false,
): MetricTrend {
  return {
    key: "hrv",
    name: "HRV",
    unit: "ms",
    group: "heart",
    value: null,
    raw: null,
    delta: null,
    tone: "neutral",
    partial,
    yesterdayValue: null,
    baseline,
    values,
    lastDate: "2026-11-03",
  };
}

describe("chart", () => {
  test("rolling and weekly means skip missing days", () => {
    expect(rollingMeans([1, 2, 3, null, 5], 2)).toEqual([2, 2.75]);
    expect(weeklyMeans([1, 1, 1, 1, 1, 1, 1, 3, 3, 3, 3, 3, 3, 3], 14)).toEqual([1, 3]);
    expect(rollingMeans([null, null], 2)).toEqual([null, null]);
  });

  test("the band is baseline ± 1 SD inside a fixed baseline ± 3 SD range", () => {
    const shape = chartShape(metric(Array(40).fill(50), { mean: 50, sd: 5 }), "2w");
    // ±3 SD maps onto y 96…4, so ±1 SD is the middle third.
    expect(shape.band?.y).toBeCloseTo(4 + 92 / 3);
    expect(shape.band?.height).toBeCloseTo(92 / 3);
    expect(shape.dots.match(/M/g)).toHaveLength(14);
    expect(shape.line.startsWith("M0.0,50.0")).toBe(true);
  });

  test("1Y has weekly means and no dots, and the line breaks over gaps", () => {
    const values: (number | null)[] = Array(371).fill(50);
    values.fill(null, 100, 120);
    const shape = chartShape(metric(values, null), "1y");
    expect(shape.dots).toBe("");
    expect(shape.line.match(/M/g)?.length).toBe(2);
  });

  test("every chart ends in a solid dot at today's value", () => {
    const values = [...Array(39).fill(50), 65];

    const shape = chartShape(metric(values, { mean: 50, sd: 5 }), "1y");

    // 65 is baseline + 3 SD, the top of the range.
    expect(shape.latest).toBe("M600,4.0h0");
    expect(chartShape(metric([...values, null], null), "2w").latest).toBe("");
  });

  test("a running total for today is a dot, but stays out of the line", () => {
    const values = [...Array(39).fill(50), 5];

    const shape = chartShape(metric(values, { mean: 50, sd: 5 }, true), "2w");

    expect(shape.dots.match(/M/g)).toHaveLength(14);
    expect(shape.line.match(/[ML]/g)).toHaveLength(13);
    expect(shape.line).not.toContain("96.0");
    expect(shape.latest).toBe("M600,96.0h0");
  });

  test("range label", () => {
    expect(rangeLabel("2026-11-03", "1m")).toBe("5 Oct – 3 Nov");
    expect(rangeLabel("2026-11-03", "1y")).toBe("5 Nov 2025 – 3 Nov");
  });
});

describe("format and clock", () => {
  test("dates and countdowns", () => {
    expect(longDate("2026-11-03")).toBe("Tuesday 3 November");
    expect(dateSpan("2026-11-03", "2026-11-09")).toBe("3–9 Nov");
    expect(dateSpan("2026-11-28", "2026-12-04")).toBe("28 Nov – 4 Dec");
    expect(startsIn(48)).toBe("in 48 min");
    expect(startsIn(125)).toBe("in 2h 05m");
    expect(startsIn(-3)).toBe("now");
  });

  test("now in the server's time zone, not the browser's", () => {
    const now = nowIn("America/Los_Angeles", new Date("2026-11-04T03:30:00Z"));
    expect(now).toEqual({ date: "2026-11-03", time: "19:30", minutes: 1170 });
  });
});
