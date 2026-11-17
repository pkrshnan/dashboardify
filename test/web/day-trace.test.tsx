import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import { DayTrace } from "../../web/components/day-trace";
import { useDom } from "./dom";

useDom();

const DAY = "2026-11-03";
const minutes = (count: number, value: (i: number) => number | null) =>
  Array.from({ length: count }, (_, i) => value(i));

/** 12:00 on 3 Nov: heart rate and skin temperature for the first ten minutes past 08:00. */
function trace() {
  const hr = minutes(720, (i) => (i >= 480 && i < 490 ? 60 + i - 480 : null));
  const temp = minutes(720, (i) => (i >= 480 && i < 490 ? 33.4 : null));
  const busy: Record<number, number> = { 96: 420, 97: 80 };
  const steps = minutes(144, (i) => busy[i] ?? null);
  const wire = (values: (number | null)[]) => ({
    values: values.map((v) => v ?? 0),
    missingIndexes: values.flatMap((v, i) => (v === null ? [i] : [])),
  });
  return {
    name: `days/${DAY}/trace`,
    startTime: `${DAY}T00:00:00Z`,
    endTime: `${DAY}T12:00:00Z`,
    series: [
      {
        kind: "KIND_HEART_RATE",
        bucketSeconds: 60,
        ...wire(hr),
        low: wire(hr).values,
        high: wire(hr).values,
      },
      { kind: "KIND_STEPS", bucketSeconds: 300, ...wire(steps) },
      { kind: "KIND_SKIN_TEMPERATURE", bucketSeconds: 60, ...wire(temp) },
    ],
    spans: [
      { kind: "KIND_SLEEP", startTime: `${DAY}T00:00:00Z`, endTime: `${DAY}T07:00:00Z` },
      {
        kind: "KIND_WORKOUT",
        startTime: `${DAY}T08:00:00Z`,
        endTime: `${DAY}T08:40:00Z`,
        workoutKind: "lifting",
      },
    ],
    maxHeartRate: 190,
  };
}

let body: unknown;
let original: typeof fetch;

beforeEach(() => {
  body = trace();
  original = globalThis.fetch;
  globalThis.fetch = (async () => Response.json(body)) as unknown as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

function show(date = DAY, isPhone = false) {
  return render(
    <DayTrace
      token="t"
      date={date}
      today={DAY}
      timeZone="UTC"
      isPhone={isPhone}
      onUnauthorized={() => undefined}
    />,
  );
}

describe("Day section", () => {
  test("each chart heads with its latest value, steps with the day's total", async () => {
    const page = show();

    expect(await page.findByText("69")).toBeTruthy();
    const heads = [...page.container.querySelectorAll(".trace-head")].map((h) => h.textContent);
    expect(heads).toEqual(["Heart rate69bpm", "Steps500steps", "Skin temperature33.4°C"]);
    expect(page.getByText("at 08:09 · 60–69 today")).toBeTruthy();
  });

  test("today is titled Today and stops at a now line; another day by its date", async () => {
    const today = show();
    await today.findByText("69");

    expect(today.getByRole("heading", { name: "Today" })).toBeTruthy();
    expect(today.container.querySelectorAll(".trace-now")).toHaveLength(3);
    today.unmount();

    body = { ...trace(), endTime: "2026-11-02T00:00:00Z", startTime: "2026-11-01T00:00:00Z" };
    const past = show("2026-11-01");
    await past.findByText("69");

    expect(past.getByRole("heading", { name: "Sun 1 Nov" })).toBeTruthy();
    expect(past.getByText("at 08:09 · 60–69")).toBeTruthy();
  });

  test("the zone lines are heart rate's grid, labelled in bpm and by zone", async () => {
    const page = show();
    await page.findByText("69");

    expect(page.getByText("95")).toBeTruthy();
    expect(page.getByText("171")).toBeTruthy();
    expect(["Z1", "Z2", "Z3", "Z4", "Z5"].every((z) => page.getByText(z))).toBe(true);
  });

  test("sleep and workouts are shaded on every chart, and named over heart rate on desktop", async () => {
    const page = show();
    await page.findByText("69");

    expect(page.container.querySelectorAll(".trace-span.sleep")).toHaveLength(3);
    expect(page.container.querySelectorAll(".trace-span.workout")).toHaveLength(3);
    expect(page.getByText("Lifting 08:00–08:40")).toBeTruthy();
  });

  test("the phone leaves the names out and marks every 6 hours", async () => {
    const page = show(DAY, true);
    await page.findByText("69");

    expect(page.queryByText("Lifting 08:00–08:40")).toBeNull();
    const hours = [...page.container.querySelectorAll(".trace-hours")][0];
    expect(hours?.textContent).toBe("00:0006:0012:0018:0024:00");
  });

  test("a day without strap data says so", async () => {
    body = {
      ...trace(),
      series: trace().series.map((s) => ({ ...s, missingIndexes: s.values.map((_, i) => i) })),
    };
    const page = show();

    expect(await page.findByText("No strap data for this day.")).toBeTruthy();
  });
});
