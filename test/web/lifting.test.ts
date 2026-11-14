import { describe, expect, test } from "bun:test";
import type { ExerciseView, SessionView } from "../../web/api";
import {
  byLastDay,
  inRange,
  matching,
  repsChart,
  runTexts,
  weekdayLabel,
  weightChart,
  workingText,
} from "../../web/lib/lifting";

function session(
  date: string,
  top: number | null,
  reps: number[],
  extra: Partial<SessionView> = {},
) {
  return {
    date,
    sets: reps.map((r) => ({ weight: top, reps: r, warmUp: false })),
    topWeight: top,
    repsAtTop: reps,
    est1rm: top === null ? null : top * (1 + reps.reduce((a, b) => a + b, 0) / reps.length / 30),
    progress: "",
    restSeconds: null,
    peakHr: null,
    records: [],
    ...extra,
  } satisfies SessionView;
}

function exercise(title: string, last: SessionView, aliases: string[] = []): ExerciseView {
  return {
    slug: title.toLowerCase().replace(/ /g, "-"),
    title,
    aliases,
    path: "",
    unit: "lb",
    range: { low: 8, high: 12, step: 5 },
    sessions: [last],
    records: { heaviest: null, est1rm: null, atTop: null },
    next: null,
  };
}

describe("lookup", () => {
  const all = [
    exercise("Leg Press", session("2026-11-12", 200, [10, 10, 10])),
    exercise("Lat Pulldown", session("2026-11-09", 75, [9, 9, 8])),
    exercise("Standing Calf Raise", session("2026-11-12", 60, [15, 15, 15])),
    exercise("Dumbbell Shoulder Press", session("2026-11-08", 15, [10, 10, 8]), [
      "Dumbell Shoulder Press",
    ]),
  ];

  test("exercises sit under the day they were last done, newest first", () => {
    expect(byLastDay(all).map((g) => [g.label, g.exercises.map((e) => e.title)])).toEqual([
      ["Thu 12 Nov", ["Leg Press", "Standing Calf Raise"]],
      ["Mon 9 Nov", ["Lat Pulldown"]],
      ["Sun 8 Nov", ["Dumbbell Shoulder Press"]],
    ]);
  });

  test("search matches titles and aliases, ignoring case", () => {
    expect(matching(all, "press").map((e) => e.title)).toEqual([
      "Leg Press",
      "Dumbbell Shoulder Press",
    ]);
    expect(matching(all, "dumbell").map((e) => e.title)).toEqual(["Dumbbell Shoulder Press"]);
    expect(matching(all, "  ")).toHaveLength(4);
  });

  test("weekday labels", () => {
    expect(weekdayLabel("2026-11-14")).toBe("Sat 14 Nov");
  });
});

describe("set text", () => {
  const sets = [
    { weight: 60, reps: 10, warmUp: true },
    { weight: 80, reps: 10, warmUp: false },
    { weight: 80, reps: 10, warmUp: false },
    { weight: 80, reps: 9, warmUp: false },
  ];

  test("runs at one weight, warm-ups marked", () => {
    expect(runTexts(sets, "lb")).toEqual([
      { text: "60 lb, 1x10", warmUp: true },
      { text: "80 lb, 2x10, 1x9", warmUp: false },
    ]);
  });

  test("the working sets alone, as one line", () => {
    expect(workingText(sets, "lb")).toBe("80 lb, 2x10, 1x9");
    expect(workingText([{ weight: null, reps: 12, warmUp: false }], "lb")).toBe("1x12");
  });
});

describe("charts", () => {
  // Newest first, as the API sends them.
  const sessions = [
    session("2026-11-08", 80, [10, 10, 10]),
    session("2026-10-31", 80, [10, 10, 9]),
    session("2026-10-10", 80, [9, 8, 8], { records: ["heaviest"] }),
    session("2026-10-03", 75, [12, 12, 12]),
    session("2025-06-01", 60, [8, 8, 8]),
  ];

  test("the range keeps recent sessions, oldest first", () => {
    expect(inRange(sessions, "3m", "2026-11-14").map((s) => s.date)).toEqual([
      "2026-10-03",
      "2026-10-10",
      "2026-10-31",
      "2026-11-08",
    ]);
    expect(inRange(sessions, "all", "2026-11-14")).toHaveLength(5);
  });

  test("the weight chart steps up where the top weight rose and marks the heaviest", () => {
    const chart = weightChart(inRange(sessions, "3m", "2026-11-14"));

    expect(chart?.steps.match(/V/g)).toHaveLength(3);
    expect(chart?.dots.map((d) => d.heaviest)).toEqual([false, true, false, false]);
    expect(chart?.ticks.map((t) => t.label)).toEqual(["75", "80"]);
    // The est. 1RM rises across the three sessions at 80 lb, so y falls.
    const ys = (chart?.estimate ?? "").split(" ").map((p) => Number(p.split(",")[1]));
    expect(ys[1]).toBeGreaterThan(ys[2] ?? 0);
    expect(ys[2]).toBeGreaterThan(ys[3] ?? 0);
  });

  test("reps bars group by weight, with a divider where it changed", () => {
    const chart = repsChart(inRange(sessions, "3m", "2026-11-14"), "lb");

    expect(chart?.groups.map((g) => g.label)).toEqual(["75 lb", "80 lb"]);
    expect(chart?.dividers).toHaveLength(1);
    expect(chart?.bars.map((b) => b.shade)).toEqual([0, 1, 1, 1]);
    // 36 reps is the tallest bar.
    expect(chart?.bars[0]?.height).toBeGreaterThan(chart?.bars[3]?.height ?? 0);
  });

  test("bodyweight has no weight chart", () => {
    expect(weightChart([session("2026-11-08", null, [10, 9])])).toBeNull();
    expect(repsChart([session("2026-11-08", null, [10, 9])], "lb")?.groups[0]?.label).toBe(
      "bodyweight",
    );
  });
});
