import { describe, expect, test } from "bun:test";
import { fireEvent, render } from "@testing-library/preact";
import type { DayAgenda } from "../../src/home/types";
import { WeekColumns, WeekStrip } from "../../web/components/week";
import { allDay, day, event, reminder, useDom } from "./dom";

useDom();

const DATES = [
  "2026-11-09",
  "2026-11-10",
  "2026-11-11",
  "2026-11-12",
  "2026-11-13",
  "2026-11-14",
  "2026-11-15",
];

/** A week from Mon 9 Nov, with the given items on its first day. */
function week(
  first: Partial<DayAgenda> = {},
  rest: Record<number, Partial<DayAgenda>> = {},
): DayAgenda[] {
  return DATES.map((date, i) => day(date, i === 0 ? first : rest[i]));
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

function columns(days: DayAgenda[], nowMin = 9 * 60) {
  const view = render(<WeekColumns days={days} nowMin={nowMin} />);
  const cols = [...view.container.querySelectorAll<HTMLElement>(".week-col")];
  const blocks = (i: number) => [...(cols[i]?.querySelectorAll<HTMLElement>(".week-event") ?? [])];
  return { ...view, cols, blocks };
}

describe("WeekColumns", () => {
  test("seven columns from today, with today marked", () => {
    const { cols } = columns(week());
    expect(cols.map((c) => text(c.querySelector(".week-day")))).toEqual([
      "Mon 9",
      "Tue 10",
      "Wed 11",
      "Thu 12",
      "Fri 13",
      "Sat 14",
      "Sun 15",
    ]);
    expect(cols.map((c) => c.querySelector(".week-day")?.classList.contains("today"))).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
  });

  test("an event sits at its time from 07:00, 36px an hour", () => {
    const { blocks } = columns(week({ events: [event("Standup", 9 * 60, 10 * 60)] }));
    const [b] = blocks(0);
    expect([b?.style.top, b?.style.height, b?.title, text(b)]).toEqual([
      "72px",
      "34px",
      "Standup",
      "Standup",
    ]);
    expect(b?.style.left).toBe("calc(0% + 2px)");
    expect(b?.style.width).toBe("calc(100% - 4px)");
  });

  test("events go in their own day's column", () => {
    const { blocks } = columns(week({}, { 2: { events: [event("Dentist", 15 * 60, 16 * 60)] } }));
    expect(blocks(0)).toHaveLength(0);
    expect(blocks(2).map(text)).toEqual(["Dentist"]);
  });

  test("events at the same time sit side by side", () => {
    const { blocks } = columns(
      week({ events: [event("Design review", 10 * 60, 11 * 60), event("1:1", 10 * 60, 11 * 60)] }),
    );
    expect(blocks(0).map((b) => [b.style.top, b.style.left, b.style.width])).toEqual([
      ["108px", "calc(0% + 2px)", "calc(50% - 4px)"],
      ["108px", "calc(50% + 2px)", "calc(50% - 4px)"],
    ]);
  });

  test("events with the same time and title both show", () => {
    const { blocks } = columns(
      week({
        events: [
          event("Focus", 10 * 60, 11 * 60),
          event("Focus", 10 * 60, 11 * 60, { category: "focus" }),
        ],
      }),
    );
    expect(blocks(0)).toHaveLength(2);
  });

  test("an event that overlaps nothing keeps the full width", () => {
    const { blocks } = columns(
      week({
        events: [
          event("A", 10 * 60, 11 * 60),
          event("B", 10 * 60 + 30, 11 * 60 + 30),
          event("C", 14 * 60, 15 * 60),
        ],
      }),
    );
    expect(blocks(0).map((b) => b.style.width)).toEqual([
      "calc(50% - 4px)",
      "calc(50% - 4px)",
      "calc(100% - 4px)",
    ]);
  });

  test("short events are at least 20px, and back-to-back ones don't cover each other", () => {
    const { blocks } = columns(
      week({
        events: [
          event("Call", 10 * 60, 10 * 60 + 15),
          event("Next call", 10 * 60 + 15, 10 * 60 + 30),
        ],
      }),
    );
    expect(blocks(0).map((b) => [b.style.top, b.style.height, b.style.width])).toEqual([
      ["108px", "20px", "calc(50% - 4px)"],
      ["117px", "20px", "calc(50% - 4px)"],
    ]);
  });

  test("events outside 07:00–22:00 are clipped to its edges", () => {
    const { blocks } = columns(
      week({ events: [event("Run", 6 * 60, 8 * 60), event("Party", 21 * 60, 23 * 60)] }),
    );
    expect(blocks(0).map((b) => [b.style.top, b.style.height])).toEqual([
      ["0px", "34px"],
      ["504px", "34px"],
    ]);
  });

  test("all-day events and undated tasks go at the top of their day", () => {
    const { cols } = columns(
      week({ allDay: [allDay("Holiday", { category: "personal" })], dated: ["Renew passport"] }),
    );
    const top = cols[0]?.querySelector(".week-dated");
    expect([...(top?.children ?? [])].map(text)).toEqual(["Holiday", "Renew passport"]);
    expect(top?.firstElementChild?.getAttribute("title")).toBe("Holiday, all day");
    expect(top?.querySelector<HTMLElement>(".all-day")?.style.borderColor).toBe("#BF5AF2");
    expect(cols[0]?.querySelector(".week-body .week-event")).toBeNull();
  });

  test("reminders sit at their time", () => {
    const { cols } = columns(week({ reminders: [reminder("Call the bank", 12 * 60)] }));
    const r = cols[0]?.querySelector<HTMLElement>(".week-reminder");
    expect([r?.style.top, text(r)]).toEqual(["180px", "Call the bank"]);
  });

  test("the now line is only in today's column, and only inside the hours", () => {
    const now = columns(week(), 9 * 60 + 30);
    expect(now.cols.map((c) => c.querySelector(".now-line") !== null)).toEqual([
      true,
      false,
      false,
      false,
      false,
      false,
      false,
    ]);
    expect(now.cols[0]?.querySelector<HTMLElement>(".now-line")?.style.top).toBe("90px");
    now.unmount();
    expect(columns(week(), 23 * 60).container.querySelector(".now-line")).toBeNull();
  });
});

describe("WeekStrip", () => {
  function strip(days: DayAgenda[]) {
    const view = render(<WeekStrip days={days} />);
    const rows = () =>
      [...view.container.querySelectorAll(".agenda-row")].map((row) => {
        const parts = [...row.querySelectorAll(".agenda-time, .ell")];
        return parts.length > 0 ? parts.map(text).join(" | ") : text(row);
      });
    const buttons = [...view.container.querySelectorAll<HTMLButtonElement>(".day-strip button")];
    return { ...view, rows, buttons };
  }

  test("starts on today, with all-day events, then undated tasks, then the rest by time", () => {
    const { rows, buttons } = strip(
      week({
        events: [event("Lunch", 12 * 60, 13 * 60), event("Standup", 9 * 60, 9 * 60 + 15)],
        reminders: [reminder("Call the bank", 10 * 60)],
        dated: ["Renew passport"],
        allDay: [allDay("Holiday")],
      }),
    );
    expect(buttons.map((b) => b.getAttribute("aria-pressed"))).toEqual([
      "true",
      "false",
      "false",
      "false",
      "false",
      "false",
      "false",
    ]);
    expect(rows()).toEqual([
      "All day | Holiday",
      " | Renew passport",
      "09:00 | Standup",
      "10:00 | Call the bank",
      "12:00 | Lunch",
    ]);
  });

  test("events have filled markers, reminders hollow ones and all-day events squares", () => {
    const { container } = strip(
      week({
        events: [event("Standup", 9 * 60, 10 * 60)],
        reminders: [reminder("Call the bank", 10 * 60)],
        allDay: [allDay("Holiday")],
      }),
    );
    const markers = [...container.querySelectorAll<HTMLElement>(".agenda-marker")];
    expect(markers.map((m) => [m.classList.contains("all-day"), m.style.background])).toEqual([
      [true, "transparent"],
      [false, "#0A84FF"],
      [false, "transparent"],
    ]);
  });

  test("tapping a day shows its agenda", () => {
    const { rows, buttons, getByLabelText } = strip(
      week(
        { events: [event("Standup", 9 * 60, 10 * 60)] },
        { 3: { events: [event("Dentist", 15 * 60, 16 * 60)] } },
      ),
    );
    fireEvent.click(getByLabelText("Thu 12"));
    expect(rows()).toEqual(["15:00 | Dentist"]);
    expect(buttons[3]?.getAttribute("aria-pressed")).toBe("true");
    expect(buttons[0]?.getAttribute("aria-pressed")).toBe("false");
  });

  test("a day with nothing on says so", () => {
    const { rows, getByLabelText } = strip(week({ events: [event("Standup", 9 * 60, 10 * 60)] }));
    fireEvent.click(getByLabelText("Tue 10"));
    expect(rows()).toEqual(["Nothing planned."]);
  });

  test("only days with something on have a dot", () => {
    const { buttons } = strip(
      week({ dated: ["Renew passport"] }, { 4: { allDay: [allDay("Holiday")] } }),
    );
    expect(
      buttons.map((b) => b.querySelector<HTMLElement>(".dot")?.style.background !== "transparent"),
    ).toEqual([true, false, false, false, true, false, false]);
  });

  test("two events with the same time and title both show", () => {
    const { rows } = strip(
      week({
        events: [
          event("Focus", 10 * 60, 11 * 60),
          event("Focus", 10 * 60, 11 * 60, { event: "b" }),
        ],
      }),
    );
    expect(rows()).toEqual(["10:00 | Focus", "10:00 | Focus"]);
  });
});
