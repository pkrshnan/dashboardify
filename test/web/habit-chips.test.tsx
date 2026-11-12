import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { fireEvent, render, waitFor } from "@testing-library/preact";
import type { HomeHabit } from "../../src/home/types";
import { HabitChips } from "../../web/components/habit-chips";
import { useDom } from "./dom";

useDom();

const HABITS: HomeHabit[] = [
  { id: "read", name: "Read", color: "#FF7EB6", day: "2026-11-12", done: false, auto: false },
  { id: "steps", name: "Steps", color: "#64D2FF", day: "2026-11-12", done: true, auto: true },
];

let calls: { url: string; body: unknown }[];
let original: typeof fetch;

beforeEach(() => {
  calls = [];
  original = globalThis.fetch;
  globalThis.fetch = (async (url: string, init?: RequestInit) => {
    calls.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return new Response(JSON.stringify({ name: "habits/read" }), { status: 200 });
  }) as typeof fetch;
});
afterEach(() => {
  globalThis.fetch = original;
});

describe("HabitChips", () => {
  test("a chip per habit, pressed when done; tapping ticks it for its day and reloads", async () => {
    let reloads = 0;
    const page = render(
      <HabitChips habits={HABITS} token="t" reload={async () => void reloads++} />,
    );
    const read = page.getByRole("button", { name: "Read" });

    expect(page.getByRole("button", { name: "Steps" }).getAttribute("aria-pressed")).toBe("true");
    fireEvent.click(read);

    expect(read.getAttribute("aria-pressed")).toBe("true");
    await waitFor(() => expect(reloads).toBe(1));
    expect(calls).toEqual([
      {
        url: "/v1/habits/read:mark",
        body: { day: { year: 2026, month: 11, day: 12 }, done: true },
      },
    ]);
  });

  test("shows nothing without habits", () => {
    const page = render(<HabitChips habits={[]} token="t" reload={async () => undefined} />);

    expect(page.container.innerHTML).toBe("");
  });
});
