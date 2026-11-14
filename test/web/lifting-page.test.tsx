import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import { AppContext } from "../../web/modules/context";
import { lifting } from "../../web/modules/lifting";
import type { LoadedHome } from "../../web/modules/types";
import { useDom } from "./dom";

useDom();

const date = (iso: string) => {
  const [year, month, day] = iso.split("-").map(Number);
  return { year, month, day };
};
const set = (weight: number, reps: number, warmUp = false) => ({ weight, reps, warmUp });

const CHEST = {
  name: "exercises/chest-press",
  title: "Chest Press",
  path: "Lifting/Chest Press.md",
  unit: "lb",
  repRange: { low: 8, high: 12, step: 5 },
  sessions: [
    {
      date: date("2026-11-08"),
      sets: [set(60, 10, true), set(80, 10), set(80, 10), set(80, 10)],
      topWeight: 80,
      repsAtTop: [10, 10, 10],
      estOneRepMax: 106.7,
      progress: "reps",
      restSeconds: 125,
      peakHeartRate: 141,
      records: ["est_one_rep_max", "at_top"],
    },
    {
      date: date("2026-10-31"),
      sets: [set(80, 10), set(80, 10), set(80, 9)],
      topWeight: 80,
      repsAtTop: [10, 10, 9],
      estOneRepMax: 105.8,
      progress: "weight",
      records: ["heaviest"],
    },
  ],
  records: {
    heaviest: 80,
    heaviestDate: date("2026-10-31"),
    estOneRepMax: 106.7,
    estOneRepMaxDate: date("2026-11-08"),
    repsAtTop: [10, 10, 10],
    repsAtTopDate: date("2026-11-08"),
  },
  nextTime: {
    sets: [set(60, 10, true), set(80, 11), set(80, 11), set(80, 11)],
    reason: "more-reps",
  },
};
const LEG = {
  name: "exercises/leg-press",
  title: "Leg Press",
  unit: "lb",
  sessions: [{ date: date("2026-11-12"), sets: [set(200, 10)], topWeight: 200, repsAtTop: [10] }],
};

let calls: { method: string; url: string; body: unknown }[];
let original: typeof fetch;

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url === "/v1/exercises") {
      return Response.json({
        exercises: [LEG, { ...CHEST, sessions: CHEST.sessions.slice(0, 1) }],
      });
    }
    return Response.json(url.includes("leg-press") ? LEG : CHEST);
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

const HOME = { view: { date: "2026-11-14", timeZone: "UTC" } } as unknown as LoadedHome;

function showLifting(path: string, isPhone = false) {
  const View = lifting.view;
  const exercise = path.split("/")[2];
  return render(
    <AppContext.Provider value={{ token: "t", onUnauthorized: () => undefined, isPhone }}>
      <View route={{ path, query: {} }} params={exercise ? { exercise } : {}} home={HOME} />
    </AppContext.Provider>,
  );
}

describe("Lifting page", () => {
  test("lists exercises under the day last done, and opens one", async () => {
    const page = showLifting("/lifting/chest-press");

    await waitFor(() => expect(page.getByText("Next time")).toBeTruthy());
    expect(page.getByText("Thu 12 Nov")).toBeTruthy();
    expect(page.getByText("Sun 8 Nov")).toBeTruthy();
    expect(page.getAllByText("80 lb, 3x11")).toHaveLength(1);
    expect(page.getByText("est. 1RM 107 lb · rest 2:05 · peak 141 bpm")).toBeTruthy();
    expect(page.getByText("best est. 1RM")).toBeTruthy();
    expect(page.getByRole("img", { name: /Top weight/ })).toBeTruthy();
  });

  test("search narrows the list", async () => {
    const page = showLifting("/lifting/chest-press");
    await waitFor(() => expect(page.getByText("Leg Press")).toBeTruthy());

    fireEvent.input(page.getByLabelText("Find an exercise"), { target: { value: "leg" } });

    expect(page.queryByRole("link", { name: /Chest Press/ })).toBeNull();
    expect(page.getByRole("link", { name: /Leg Press/ })).toBeTruthy();
  });

  test("the rep range link opens a form that writes the range", async () => {
    const page = showLifting("/lifting/chest-press");
    await waitFor(() => expect(page.getByText("8–12 reps · +5 lb")).toBeTruthy());

    fireEvent.click(page.getByText("8–12 reps · +5 lb"));
    fireEvent.input(page.getByLabelText("Most reps"), { target: { value: "10" } });
    const form = page.getByRole("button", { name: "Save" }).closest("form");
    if (!form) {
      throw new Error("no form");
    }
    fireEvent.submit(form);

    await waitFor(() => expect(calls.some((c) => c.method === "PATCH")).toBe(true));
    expect(calls.find((c) => c.method === "PATCH")).toEqual({
      method: "PATCH",
      url: "/v1/exercises/chest-press",
      body: { repRange: { low: 8, high: 10, step: 5 } },
    });
  });

  test("on the phone, the list is the page and an exercise has a way back", async () => {
    const list = showLifting("/lifting", true);
    await waitFor(() => expect(list.getByText("Leg Press")).toBeTruthy());
    expect(list.queryByText("Next time")).toBeNull();
    list.unmount();

    const one = showLifting("/lifting/chest-press", true);

    await waitFor(() => expect(one.getByText("Next time")).toBeTruthy());
    expect(one.getByText("‹ Lifting")).toBeTruthy();
  });
});
