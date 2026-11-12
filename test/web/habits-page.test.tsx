import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import { AppContext } from "../../web/modules/context";
import { habits } from "../../web/modules/habits";
import { useDom } from "./dom";

useDom();

const TODAY = { year: 2026, month: 11, day: 12 };
const READ = {
  name: "habits/read",
  displayName: "Read",
  schedule: { kind: "KIND_DAILY" },
  color: "#FF7EB6",
  state: "STATE_ACTIVE",
  startDate: { year: 2026, month: 9, day: 1 },
  progress: { day: TODAY, streak: 4, unit: "UNIT_DAY", recentDone: 26, recentOf: 30, due: true },
  etag: "e1",
};
const LIFT = {
  ...READ,
  name: "habits/lift",
  displayName: "Lift",
  schedule: { kind: "KIND_WEEKLY", timesPerWeek: 3 },
  auto: "lifting",
  color: "#40C8E0",
  progress: { day: TODAY, streak: 7, unit: "UNIT_WEEK", thisWeek: 2, due: true },
};
const FACTS = [
  { name: "steps", label: "Steps", kind: "count", defaultRule: "steps ≥ 8000" },
  { name: "lifting", label: "Lifting", kind: "count", defaultRule: "lifting ≥ 1" },
];
const DAYS = {
  days: [
    { date: { year: 2026, month: 11, day: 10 }, mark: "MARK_DONE", scheduled: true, ticked: true },
    { date: { year: 2026, month: 11, day: 11 }, mark: "MARK_OPEN", scheduled: true },
    { date: TODAY, mark: "MARK_OPEN", scheduled: true },
  ],
};

let calls: { method: string; url: string; body: unknown }[];
let original: typeof fetch;

function answer(url: string, method: string): unknown {
  if (url === "/v1/habits") {
    return method === "POST" ? { ...READ, name: "habits/stretch" } : { habits: [READ, LIFT] };
  }
  if (url === "/v1/habitFacts") {
    return { facts: FACTS };
  }
  return url.includes("/days?") ? DAYS : READ;
}

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const method = init?.method ?? "GET";
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method, url, body });
    return new Response(JSON.stringify(answer(url, method)), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

function showHabits(params: Record<string, string> = {}, isPhone = false) {
  const View = habits.view;
  return render(
    <AppContext.Provider value={{ token: "t", onUnauthorized: () => undefined, isPhone }}>
      <View route={{ path: "/habits", query: {} }} params={params} home={null} />
    </AppContext.Provider>,
  );
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("Habits page", () => {
  test("shows each habit's cadence, streak and grid; a weekly one has this week's dots", async () => {
    const page = showHabits();

    await page.findAllByText("Read");
    await waitFor(() => expect(page.container.querySelectorAll(".habit-cell.done").length).toBe(2));

    expect(page.getByText("26 of 30, last 30 days")).toBeTruthy();
    expect(page.getByText("3× a week · Lifting")).toBeTruthy();
    expect(page.getByRole("img", { name: "2 of 3 this week" })).toBeTruthy();
    expect(page.getByText("Thursday 12 Nov · 0 of 2 done today")).toBeTruthy();
  });

  test("the small tick marks today, and a square fixes its day", async () => {
    const page = showHabits();
    await page.findAllByText("Read");

    fireEvent.click(page.getByRole("button", { name: "Tick Read for today" }));
    const square = await page.findAllByRole("button", { name: "Wed 11 Nov · not done" });
    fireEvent.click(square[0] as HTMLElement);

    await waitFor(() => expect(writes()).toHaveLength(2));
    expect(writes().map((c) => [c.url, c.body])).toEqual([
      ["/v1/habits/read:mark", { day: TODAY, done: true }],
      ["/v1/habits/read:mark", { day: { year: 2026, month: 11, day: 11 }, done: true }],
    ]);
  });

  test("the tick shows at once, before the server answers", async () => {
    const page = showHabits();
    await page.findAllByText("Read");
    await waitFor(() => expect(page.container.querySelectorAll(".habit-cell.done").length).toBe(2));
    let answer: () => void = () => undefined;
    const slow = globalThis.fetch;
    globalThis.fetch = ((url: string, init?: RequestInit) =>
      new Promise<Response>((resolve) => {
        answer = () => resolve(slow(url, init));
      })) as typeof fetch;

    fireEvent.click(page.getByRole("button", { name: "Tick Read for today" }));

    expect(page.getByRole("button", { name: "Untick Read for today" })).toBeTruthy();
    answer();
  });

  test("adds a habit three times a week that ticks itself from steps", async () => {
    const page = showHabits({ habit: "new" });
    await page.findByText("New habit");

    fireEvent.input(page.getByLabelText("Name"), { target: { value: "Stretch" } });
    fireEvent.click(page.getByRole("button", { name: "Weekly" }));
    fireEvent.click(page.getByRole("button", { name: "Fewer times a week" }));
    fireEvent.click(page.getByRole("button", { name: "Ticks itself from" }));
    fireEvent.click(page.getByRole("menuitemradio", { name: "Steps" }));
    fireEvent.submit(
      page.getByRole("button", { name: "Add habit" }).closest("form") as HTMLFormElement,
    );

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.body).toEqual({
      displayName: "Stretch",
      schedule: { kind: "KIND_WEEKLY", timesPerWeek: 2 },
      auto: "steps ≥ 8000",
      color: "",
    });
  });

  test("edits the selected habit's days with the update mask", async () => {
    const page = showHabits({ habit: "read" });
    await page.findByDisplayValue("Read");

    fireEvent.click(page.getByRole("button", { name: "Set days" }));
    fireEvent.click(page.getByRole("button", { name: "Tue" }));
    fireEvent.submit(page.getByRole("button", { name: "Save" }).closest("form") as HTMLFormElement);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.url).toBe("/v1/habits/read?updateMask=displayName,schedule,auto,color");
    expect(writes()[0]?.body).toMatchObject({
      schedule: { kind: "KIND_DAYS", days: ["MONDAY", "TUESDAY", "WEDNESDAY", "FRIDAY"] },
    });
  });

  test("on the phone the grid only shows; a habit's own screen fixes this week", async () => {
    const list = showHabits({}, true);
    await list.findAllByText("Read");
    expect(list.queryAllByRole("button", { name: /Nov · / })).toEqual([]);
    list.unmount();

    const one = showHabits({ habit: "read" }, true);
    const wednesday = await one.findByRole("button", { name: "Wed 11 Nov · not done" });
    fireEvent.click(wednesday);

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(one.getByRole("button", { name: "Sun 15 Nov · before it started" })).toHaveProperty(
      "disabled",
      true,
    );
  });
});
