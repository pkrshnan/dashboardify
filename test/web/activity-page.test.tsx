import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { act, fireEvent, render } from "@testing-library/preact";
import { Activity } from "../../web/components/activity";
import { useDom } from "./dom";

useDom();

const RUN = {
  name: "days/2026-11-07/workouts/0900",
  kind: "running",
  status: "WORKOUT_STATUS_CONFIRMED",
  startTime: "2026-11-07T09:00:00Z",
  endTime: "2026-11-07T09:32:00Z",
  durationMinutes: 32,
  averageHeartRate: 148,
  maxHeartRate: 162,
  strain: 10.4,
  calories: 609.6,
  distanceMeters: 5200,
  stravaActivityId: "16000000001",
};

const LIFT = {
  ...RUN,
  name: "days/2026-11-07/workouts/1800",
  kind: "lifting",
  startTime: "2026-11-07T18:00:00Z",
  endTime: "2026-11-07T18:47:00Z",
  durationMinutes: 47,
  calories: undefined,
  distanceMeters: undefined,
  stravaActivityId: undefined,
};

let original: typeof fetch;

beforeEach(() => {
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string) => {
    const answer = url.startsWith("/v1/activityDays")
      ? { days: [{ date: { year: 2026, month: 11, day: 7 }, steps: 9000, workouts: [RUN, LIFT] }] }
      : { ...RUN, heartRate: [120, 140, 150], heartRateStartTime: RUN.startTime };
    return new Response(JSON.stringify(answer), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

function showWeek() {
  return render(
    <Activity
      token="t"
      timeZone="UTC"
      today="2026-11-07"
      range="week"
      onRange={() => undefined}
      onUnauthorized={() => undefined}
    />,
  );
}

describe("workout calories", () => {
  test("a Strava run shows them after distance and pace", async () => {
    const page = showWeek();

    expect((await page.findAllByText("5.2 km · 6:09 /km · 610 kcal")).length).toBeGreaterThan(0);
  });

  test("a workout without them keeps its usual stat", async () => {
    const page = showWeek();

    expect((await page.findAllByText("strain 10.4")).length).toBeGreaterThan(0);
  });

  test("the detail has a Calories stat", async () => {
    const page = showWeek();
    const [row] = await page.findAllByRole("button", { name: /^Running/ });

    await act(async () => {
      if (row) {
        fireEvent.click(row);
      }
    });

    expect(await page.findByText("Calories")).toBeTruthy();
    expect(page.getByText("kcal")).toBeTruthy();
  });
});
