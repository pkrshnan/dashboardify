import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import { AppContext } from "../../web/modules/context";
import { lifting } from "../../web/modules/lifting";
import type { LoadedHome } from "../../web/modules/types";
import { useDom } from "./dom";

useDom();

const set = (weight: number, reps: number, warmUp = false) => ({ weight, reps, warmUp });

const CHEST = {
  name: "exercises/chest-press",
  title: "Chest Press",
  unit: "lb",
  sessions: [{ date: { year: 2026, month: 11, day: 8 }, sets: [set(80, 10)], topWeight: 80 }],
  nextTime: { sets: [set(60, 10, true), set(80, 11), set(80, 11)], reason: "more-reps" },
};
const FLY = {
  name: "exercises/cable-fly-crossover",
  title: "Cable Fly Crossovers",
  unit: "lb",
  sessions: [{ date: { year: 2026, month: 11, day: 8 }, sets: [set(12.5, 10)], topWeight: 12.5 }],
  nextTime: { sets: [set(12.5, 11)], reason: "more-reps" },
};

let calls: { method: string; url: string; body: unknown }[];
let original: typeof fetch;
let logged: unknown[];

beforeEach(() => {
  calls = [];
  logged = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ method: init?.method ?? "GET", url, body });
    if (url.startsWith("/v1/exercises")) {
      return Response.json({ exercises: [CHEST, FLY] });
    }
    return Response.json({ name: "days/2026-11-14/lifting", exercises: logged, etag: "e1" });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

const HOME = { view: { date: "2026-11-14", timeZone: "UTC" } } as unknown as LoadedHome;

function showLog(isPhone = false) {
  const View = lifting.view;
  return render(
    <AppContext.Provider value={{ token: "t", onUnauthorized: () => undefined, isPhone }}>
      <View route={{ path: "/lifting/log", query: {} }} params={{ exercise: "log" }} home={HOME} />
    </AppContext.Provider>,
  );
}

const writes = () => calls.filter((c) => c.method !== "GET");

describe("Log screen", () => {
  test("adding an exercise writes next time's sets at once", async () => {
    const page = showLog();
    await waitFor(() => expect(page.getByLabelText("Add an exercise")).toBeTruthy());

    fireEvent.input(page.getByLabelText("Add an exercise"), { target: { value: "chest" } });
    fireEvent.click(page.getByRole("button", { name: /Chest Press/ }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    // Next time as it stood before today.
    expect(
      calls.some((c) => c.url === "/v1/exercises?before.year=2026&before.month=11&before.day=14"),
    ).toBe(true);
    expect(writes()[0]).toEqual({
      method: "PATCH",
      url: "/v1/days/2026-11-14/lifting/exercises/chest-press?etag=e1",
      body: {
        title: "Chest Press",
        unit: "lb",
        sets: [
          { weight: 60, reps: 10, warmUp: true },
          { weight: 80, reps: 11, warmUp: false },
          { weight: 80, reps: 11, warmUp: false },
        ],
      },
    });
    expect(page.getAllByText("W")).toHaveLength(1);
    // The rest of that session is offered next.
    expect(page.getByText("Usually next")).toBeTruthy();
  });

  test("a stepper, a tap on the set number and a removal each save; Undo puts it back", async () => {
    logged = [
      {
        name: "days/2026-11-14/lifting/exercises/chest-press",
        title: "Chest Press",
        unit: "lb",
        sets: [set(80, 11), set(80, 11)],
      },
    ];
    const page = showLog();
    await waitFor(() => expect(page.getAllByLabelText("More reps")).toHaveLength(2));

    fireEvent.click(page.getAllByLabelText("Less reps")[1] as HTMLElement);
    fireEvent.click(page.getByLabelText("Set 1; make it a warm-up"));
    fireEvent.click(page.getByLabelText("Remove set 1"));

    await waitFor(() => expect(writes()).toHaveLength(3));
    const sets = writes().map((w) => (w.body as { sets: unknown[] }).sets);
    expect(sets[0]).toEqual([set(80, 11), set(80, 10)]);
    expect(sets[1]).toEqual([set(80, 11, true), set(80, 10)]);
    expect(sets[2]).toEqual([set(80, 11, true)]);

    fireEvent.click(page.getByRole("button", { name: "Undo" }));

    await waitFor(() => expect(writes()).toHaveLength(4));
    expect((writes()[3]?.body as { sets: unknown[] } | undefined)?.sets).toEqual([
      set(80, 11, true),
      set(80, 10),
    ]);
  });

  test("× takes an exercise out of today's note", async () => {
    logged = [
      {
        name: "days/2026-11-14/lifting/exercises/chest-press",
        title: "Chest Press",
        unit: "lb",
        sets: [set(80, 11)],
      },
    ];
    const page = showLog();
    await waitFor(() => expect(page.getByLabelText("Remove Chest Press from today")).toBeTruthy());

    fireEvent.click(page.getByLabelText("Remove Chest Press from today"));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]).toMatchObject({
      method: "DELETE",
      url: "/v1/days/2026-11-14/lifting/exercises/chest-press?etag=e1",
    });
    expect(page.getByText("Removed Chest Press")).toBeTruthy();
  });

  test("on the phone, an exercise's menu removes it and sets have no ×", async () => {
    logged = [
      {
        name: "days/2026-11-14/lifting/exercises/chest-press",
        title: "Chest Press",
        unit: "lb",
        sets: [set(80, 11)],
      },
    ];
    const page = showLog(true);
    await waitFor(() => expect(page.getByRole("button", { name: "Chest Press" })).toBeTruthy());
    expect(page.queryByLabelText("Remove set 1")).toBeNull();

    fireEvent.contextMenu(page.getByRole("button", { name: "Chest Press" }));
    fireEvent.click(page.getByRole("menuitem", { name: "Remove from workout" }));

    await waitFor(() => expect(writes()).toHaveLength(1));
    expect(writes()[0]?.method).toBe("DELETE");
  });
});
