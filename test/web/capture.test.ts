import { describe, expect, test } from "bun:test";
import { parseCapture } from "../../src/capture/parse";
import { preview, segments, switched, taskFields, typed } from "../../web/lib/capture";

// Tuesday 10 November 2026, 08:00 in London.
const context = { now: new Date("2026-11-10T08:00:00Z"), timeZone: "Europe/London" };
const noCalendar = { ...context, eventsEnabled: false };
const withCalendar = { ...context, eventsEnabled: true };

describe("segments", () => {
  test("covers the text once, with highlighted runs in order", () => {
    const text = "Lunch with Sam tomorrow 12:30–13:30";

    const runs = segments(text, parseCapture(text, context));

    expect(runs).toEqual([
      { text: "Lunch " },
      { text: "with Sam", kind: "who" },
      { text: " " },
      { text: "tomorrow 12:30–13:30", kind: "when" },
    ]);
    expect(runs.map((run) => run.text).join("")).toBe(text);
  });

  test("plain text is one run, and nothing typed is none", () => {
    expect(segments("Pay rent", parseCapture("Pay rent", context))).toEqual([{ text: "Pay rent" }]);
    expect(segments("", undefined)).toEqual([]);
  });
});

describe("box state", () => {
  test("a hand switch holds while typing", () => {
    const state = switched({ text: "Coffee with Priya" }, "reminder");

    expect(typed(state, "Coffee with Priya Thu 3pm")).toEqual({
      text: "Coffee with Priya Thu 3pm",
      override: "reminder",
    });
  });

  test("clearing the box drops the switch", () => {
    const state = switched({ text: "Coffee" }, "reminder");

    expect(typed(state, "  ")).toEqual({ text: "  " });
  });
});

describe("preview", () => {
  test("with no calendar, an event becomes a reminder and says why", () => {
    const shown = preview({ text: "Lunch with Sam tomorrow 12:30–13:30" }, noCalendar);

    expect(shown?.parse.kind).toBe("reminder");
    expect(shown?.parse.autoKind).toBe("event");
    expect(shown?.reason).toBe(
      "It reads as an event, but no calendar is connected yet, so it's a reminder.",
    );
    expect(shown?.when).toBe("Tomorrow · 12:30");
  });

  test("a reminder keeps the rule's reason", () => {
    const shown = preview({ text: "Call dentist Fri 10:00" }, noCalendar);

    expect(shown).toMatchObject({
      reason: "It starts with a verb (“call”), so it's something to do.",
      when: "Fri 13 Nov · 10:00",
      where: "Inbox",
    });
  });

  test("an event shows its day and both times", () => {
    expect(preview({ text: "Design review today 14:00-15:30" }, withCalendar)?.when).toBe(
      "Today · 14:00–15:30",
    );
  });

  test("no date is Someday, and a blank box shows nothing", () => {
    expect(preview({ text: "Pay rent" }, noCalendar)?.when).toBe("Someday");
    expect(preview({ text: " " }, noCalendar)).toBeUndefined();
  });
});

describe("taskFields", () => {
  test("sends what the preview showed", () => {
    const parse = parseCapture("Gym every Monday 7am", context);

    expect(parse && taskFields(parse)).toEqual({
      description: "Gym",
      dueDate: { year: 2026, month: 11, day: 16 },
      dueTime: { hours: 7, minutes: 0 },
      recurrence: "every week",
    });
  });

  test("leaves out what wasn't said", () => {
    const parse = parseCapture("Pay rent", context);

    expect(parse && taskFields(parse)).toEqual({ description: "Pay rent" });
  });
});
