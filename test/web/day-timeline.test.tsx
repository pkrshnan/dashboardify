import { describe, expect, mock, test } from "bun:test";
import { fireEvent, render } from "@testing-library/preact";
import { DayTimeline } from "../../web/components/day-timeline";
import { allDay, day, event, reminder, useDom } from "./dom";

useDom();

const NINE_TWELVE = 9 * 60 + 12;

function timeline(
  items: Parameters<typeof day>[1],
  options: { isPhone?: boolean; nowMin?: number } = {},
) {
  const onComplete = mock((_id: string) => undefined);
  const view = render(
    <DayTimeline
      day={day("2026-11-09", items)}
      nowMin={options.nowMin ?? NINE_TWELVE}
      isPhone={options.isPhone ?? false}
      onComplete={onComplete}
    />,
  );
  const blocks = [...view.container.querySelectorAll<HTMLElement>(".event")];
  return { ...view, blocks, onComplete };
}

function text(el: Element | null | undefined): string {
  return el?.textContent?.replace(/\s+/g, " ").trim() ?? "";
}

describe("DayTimeline", () => {
  test("hours run from an hour before now to 22:00", () => {
    const { container } = timeline({});
    const labels = [...container.querySelectorAll(".hour-label")].map(text);
    expect(labels[0]).toBe("08");
    expect(labels.at(-1)).toBe("22");
    expect(container.querySelector<HTMLElement>(".timeline")?.style.height).toBe(`${14 * 52}px`);
  });

  test("hours are taller on the phone", () => {
    const { container } = timeline({}, { isPhone: true });
    expect(container.querySelector<HTMLElement>(".timeline")?.style.height).toBe(`${14 * 56}px`);
  });

  test("an event block sits at its time, as tall as it lasts", () => {
    const { blocks } = timeline({ events: [event("Standup", 10 * 60, 11 * 60)] });
    expect(blocks).toHaveLength(1);
    expect(blocks[0]?.style.top).toBe("104px");
    expect(blocks[0]?.style.height).toBe("50px");
    expect(blocks[0]?.style.left).toBe("0%");
    expect(text(blocks[0])).toContain("Standup");
  });

  test("events at the same time share the width, side by side", () => {
    const { blocks } = timeline({
      events: [event("Design review", 10 * 60, 11 * 60), event("1:1", 10 * 60, 11 * 60)],
    });
    expect(blocks.map((b) => [b.style.top, b.style.left])).toEqual([
      ["104px", "0%"],
      ["104px", "31%"],
    ]);
    for (const b of blocks) {
      expect(b.style.width).toBe("calc(31% - 4px)");
    }
  });

  test("an event that overlaps nothing keeps the full width", () => {
    const { blocks } = timeline({
      events: [
        event("A", 10 * 60, 11 * 60),
        event("B", 10 * 60 + 30, 11 * 60),
        event("C", 14 * 60, 15 * 60),
      ],
    });
    expect(blocks.map((b) => b.style.width)).toEqual([
      "calc(31% - 4px)",
      "calc(31% - 4px)",
      "calc(62% - 0px)",
    ]);
  });

  test("past events are dimmed and the next one is brighter", () => {
    const { blocks } = timeline({
      events: [
        event("Gym", 8 * 60, 9 * 60),
        event("Standup", 10 * 60, 11 * 60),
        event("Lunch", 12 * 60, 13 * 60),
      ],
    });
    // 0.08, 0.25 and 0.15 of the work colour.
    expect(blocks.map((b) => b.style.background)).toEqual(["#0A84FF14", "#0A84FF40", "#0A84FF26"]);
  });

  test("an event still being saved has a stronger fill and a ring", () => {
    const { blocks } = timeline({ events: [event("New", 10 * 60, 11 * 60, { pending: true })] });
    expect(blocks[0]?.classList.contains("pending")).toBe(true);
    expect(blocks[0]?.style.background).toBe("#0A84FF66");
    expect(blocks[0]?.style.boxShadow).toContain("#0A84FF80");
  });

  test("a short event fits on one line", () => {
    const { blocks } = timeline({
      events: [
        event("Call", 10 * 60, 10 * 60 + 15, { detail: "Zoom" }),
        event("Workshop", 12 * 60, 14 * 60, { detail: "Room 4" }),
      ],
    });
    expect(blocks.map((b) => b.classList.contains("one-line"))).toEqual([true, false]);
    expect(text(blocks[0])).toBe("Call 10:00 · Zoom");
    expect([...(blocks[1]?.children ?? [])].map(text)).toEqual(["Workshop 12:00", "Room 4"]);
  });

  test("on the phone the time and detail go under the title", () => {
    const { blocks } = timeline(
      { events: [event("Workshop", 12 * 60, 14 * 60, { detail: "Room 4" })] },
      { isPhone: true },
    );
    const lines = [...(blocks[0]?.children ?? [])].map(text);
    expect(lines).toEqual(["Workshop", "12:00 · Room 4"]);
  });

  test("events outside the hours shown are left out", () => {
    const { blocks } = timeline(
      { events: [event("Early", 6 * 60, 7 * 60), event("Late", 23 * 60, 23 * 60 + 30)] },
      { nowMin: 9 * 60 },
    );
    // 23:00 stretches the range to 24:00, so only the early one is gone.
    expect(blocks.map(text).map((t) => t.split(" ")[0])).toEqual(["Late"]);
  });

  test("all-day events sit in a row above the hours", () => {
    const { container } = timeline({
      allDay: [allDay("Holiday"), allDay("Mum's birthday", { category: "personal" })],
    });
    const row = container.querySelector('[aria-label="All day"]');
    expect([...(row?.querySelectorAll(".all-day-event .event-title") ?? [])].map(text)).toEqual([
      "Holiday",
      "Mum's birthday",
    ]);
    expect(row?.querySelector<HTMLElement>(".all-day-event")?.style.borderLeft).toBe(
      "3px solid #0A84FF",
    );
    expect(container.querySelector(".timeline .all-day-event")).toBeNull();
  });

  test("no all-day row when there are none", () => {
    const { container } = timeline({ events: [event("Standup", 10 * 60, 11 * 60)] });
    expect(container.querySelector(".all-day-row")).toBeNull();
  });

  test("an empty day says so, unless it has an all-day event", () => {
    expect(text(timeline({}).container.querySelector(".empty-day"))).toBe(
      "Nothing on the calendar.",
    );
    expect(
      timeline({ allDay: [allDay("Holiday")] }).container.querySelector(".empty-day"),
    ).toBeNull();
    expect(
      timeline({ reminders: [reminder("Call", 600)] }).container.querySelector(".empty-day"),
    ).toBeNull();
  });

  test("the now line is at the current time", () => {
    const { container } = timeline({});
    // 9:12 is 72 minutes after 08:00.
    expect(container.querySelector<HTMLElement>(".now-line")?.style.top).toBe(
      `${(72 / 60) * 52}px`,
    );
  });

  test("ticking a reminder pill completes it", () => {
    const { container, getByLabelText, onComplete } = timeline({
      reminders: [reminder("Call the bank", 10 * 60)],
    });
    expect(container.querySelector<HTMLElement>(".reminder")?.style.top).toBe("104px");
    fireEvent.click(getByLabelText("Mark Call the bank done"));
    expect(onComplete).toHaveBeenCalledWith("Call the bank");
  });

  test("a done reminder is ticked and can't be unticked", () => {
    const { container, getByLabelText } = timeline({
      reminders: [reminder("Pay rent", 10 * 60, true)],
    });
    const box = getByLabelText("Done") as HTMLInputElement;
    expect(box.checked).toBe(true);
    expect(box.disabled).toBe(true);
    expect(container.querySelector(".reminder")?.classList.contains("done")).toBe(true);
  });
});
