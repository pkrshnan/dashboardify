import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import type { HomeView } from "../../src/home/types";
import { Calendar } from "../../web/components/calendar";
import { day, useDom } from "./dom";

useDom();

const noop = () => undefined;

const VIEW = {
  date: "2026-11-09",
  timeZone: "Europe/London",
  calendarSync: null,
  days: [9, 10, 11, 12, 13, 14, 15].map((d) => day(`2026-11-${String(d).padStart(2, "0")}`)),
} as unknown as HomeView;

function grid(aside?: string) {
  const { container } = render(
    <Calendar
      view={VIEW}
      mode="week"
      onMode={noop}
      nowMin={9 * 60}
      isPhone={false}
      onComplete={noop}
      onReopen={noop}
      aside={aside}
    />,
  );
  return container.querySelector(".calendar-grid");
}

describe("Calendar", () => {
  test("the task list sits beside the calendar", () => {
    const g = grid("Tasks");
    expect(g?.classList.contains("full")).toBe(false);
    expect(g?.querySelector("aside")?.textContent).toBe("Tasks");
  });

  test("without a task list, as in the Week view, the calendar takes the width", () => {
    const g = grid();
    expect(g?.classList.contains("full")).toBe(true);
    expect(g?.querySelector("aside")).toBeNull();
  });
});
