import { describe, expect, test } from "bun:test";
import { parseCapture } from "../../src/capture/parse";
import type { HomeView } from "../../src/home/types";
import {
  chosenPlace,
  nextCalendar,
  nextPlace,
  pendingEvent,
  preview,
  segments,
  switched,
  typed,
  withPending,
} from "../../web/lib/capture";

// Tuesday 10 November 2026, 08:00 in London.
const context = { now: new Date("2026-11-10T08:00:00Z"), timeZone: "Europe/London" };
const PERSONAL = "calendarAccounts/icloud/calendars/home";
const FITNESS = "calendarAccounts/icloud/calendars/fitness";
const hints = {
  calendars: [
    { name: PERSONAL, displayName: "Personal", category: "personal" as const },
    { name: FITNESS, displayName: "Fitness", category: "fitness" as const },
  ],
  defaultCalendar: PERSONAL,
  rules: [{ words: ["gym"], calendar: FITNESS }],
  titles: [],
};
const noCalendar = { ...context, hints: null };
const withCalendar = { ...context, hints };

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

describe("calendar choice", () => {
  test("an event shows the same guess the server makes", () => {
    const shown = preview({ text: "Gym 7am for 1h" }, withCalendar);

    expect(shown?.calendar).toMatchObject({
      name: FITNESS,
      displayName: "Fitness",
      reason: "Your rule “gym” puts it on Fitness.",
    });
    expect(shown?.where).toBe("Fitness");
  });

  test("the picker cycles through writable calendars, and the pick holds while typing", () => {
    const picked = nextCalendar({ text: "Gym 7am for 1h" }, hints, FITNESS);

    const after = typed(picked, "Gym 7am for 90 minutes");

    expect(picked.calendar).toBe(PERSONAL);
    expect(preview(after, withCalendar)?.calendar).toMatchObject({
      name: PERSONAL,
      reason: "Picked by hand.",
    });
    expect(typed(after, "").calendar).toBeUndefined();
  });

  test("a reminder has no calendar", () => {
    expect(preview({ text: "Call dentist Fri 10:00" }, withCalendar)?.calendar).toBeUndefined();
  });
});

describe("place choice", () => {
  const place = (displayName: string) => ({
    displayName,
    address: "London",
    location: { latitude: 51.5, longitude: -0.1 },
    mapsUri: "",
  });
  const found = [place("Dishoom Shoreditch"), place("Dishoom Soho")];

  test("the best match shows first, and the picker steps through the rest", () => {
    const first = chosenPlace({ text: "" }, "Dishoom", found);
    const stepped = nextPlace({ text: "" }, "Dishoom", first.index, found.length);

    expect(first.place?.displayName).toBe("Dishoom Shoreditch");
    expect(chosenPlace(stepped, "Dishoom", found).place?.displayName).toBe("Dishoom Soho");
    expect(nextPlace(stepped, "Dishoom", 1, found.length).place?.index).toBe(0);
  });

  test("a pick is forgotten once the typed place changes", () => {
    const picked = nextPlace({ text: "" }, "Dishoom", 0, 2);

    expect(chosenPlace(picked, "Barbican", found).index).toBe(0);
    expect(chosenPlace(picked, undefined, found).place).toBeUndefined();
  });

  test("the preview carries the typed place for events", () => {
    const shown = preview({ text: "Dinner at Dishoom Fri 7pm" }, withCalendar);

    expect(shown?.parse.place).toBe("Dishoom");
    expect(segments("Dinner at Dishoom Fri 7pm", shown?.parse)).toContainEqual({
      text: "at Dishoom",
      kind: "where",
    });
  });
});

describe("pending events", () => {
  const shown = preview({ text: "Lunch with Sam tomorrow 12:30–13:30" }, withCalendar);
  const day = (date: string) => ({ date, events: [], reminders: [], dated: [], allDay: [] });
  const view = { days: [day("2026-11-10"), day("2026-11-11")] } as unknown as HomeView;

  test("are drawn on their day, marked as saving", () => {
    const drawn = shown && pendingEvent(shown, "Europe/London", "r1");

    const merged = withPending(view, drawn ? [drawn] : []);

    expect(merged.days[0]?.events).toEqual([]);
    expect(merged.days[1]?.events).toEqual([
      expect.objectContaining({
        title: "Lunch with Sam",
        startMin: 750,
        endMin: 810,
        detail: "Saving to iCloud…",
        category: "personal",
        pending: true,
      }),
    ]);
  });

  test("a reminder isn't drawn", () => {
    const reminder = preview({ text: "Call dentist Fri 10:00" }, withCalendar);

    expect(reminder && pendingEvent(reminder, "Europe/London", "r2")).toBeUndefined();
  });

  test("with nothing pending the view is unchanged", () => {
    expect(withPending(view, [])).toBe(view);
  });
});
