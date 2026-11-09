import { describe, expect, test } from "bun:test";
import { type CaptureOptions, parseCapture } from "../../src/capture/parse";

// Tuesday 10 November 2026, 08:00 in London (GMT, so UTC and local agree).
const now = new Date("2026-11-10T08:00:00Z");
const timeZone = "Europe/London";

/** The parse as plain values, with each span as the words it covers. */
function read(text: string, options: Partial<CaptureOptions> = {}) {
  const parse = parseCapture(text, { now, timeZone, ...options });
  if (!parse) {
    return undefined;
  }
  return {
    kind: parse.kind,
    title: parse.title,
    start: parse.start?.toISOString(),
    end: parse.end?.toISOString(),
    dueDate: parse.dueDate,
    dueTime: parse.dueTime,
    recurrence: parse.recurrence,
    spans: parse.spans.map((span) => `${span.kind}:${text.slice(span.start, span.end)}`),
    reason: parse.reason,
  };
}

describe("parseCapture: events", () => {
  test.each([
    {
      text: "Lunch with Sam tomorrow 12:30–13:30",
      title: "Lunch with Sam",
      start: "2026-11-11T12:30:00.000Z",
      end: "2026-11-11T13:30:00.000Z",
      spans: ["who:with Sam", "when:tomorrow 12:30–13:30"],
      reason: "It has an end time or a length, so it blocks time.",
    },
    {
      text: "Design review Thu 2-3pm",
      title: "Design review",
      start: "2026-11-12T14:00:00.000Z",
      end: "2026-11-12T15:00:00.000Z",
      spans: ["when:Thu 2-3pm"],
      reason: "It has an end time or a length, so it blocks time.",
    },
    {
      text: "Gym 7am for 1h",
      title: "Gym",
      start: "2026-11-11T07:00:00.000Z",
      end: "2026-11-11T08:00:00.000Z",
      spans: ["when:7am", "when:for 1h"],
      reason: "It has an end time or a length, so it blocks time.",
    },
    {
      text: "Dentist Fri 10:00",
      title: "Dentist",
      start: "2026-11-13T10:00:00.000Z",
      end: "2026-11-13T11:00:00.000Z",
      spans: ["when:Fri 10:00"],
      reason: "“Dentist” at a time reads as an appointment. It gets an hour.",
    },
    {
      text: "Coffee with Priya Thu 3pm",
      title: "Coffee with Priya",
      start: "2026-11-12T15:00:00.000Z",
      end: "2026-11-12T16:00:00.000Z",
      spans: ["who:with Priya", "when:Thu 3pm"],
      reason: "It's with someone, so it's an event. It gets an hour.",
    },
    {
      text: "Haircut 4pm",
      title: "Haircut",
      start: "2026-11-10T16:00:00.000Z",
      end: "2026-11-10T17:00:00.000Z",
      spans: ["when:4pm"],
      reason: "“Haircut” at a time reads as an appointment. It gets an hour.",
    },
  ])("$text", ({ text, ...expected }) => {
    expect(read(text)).toMatchObject({ kind: "event", ...expected });
  });
});

describe("parseCapture: reminders", () => {
  test.each([
    {
      text: "Call dentist Fri 10:00",
      title: "Call dentist",
      dueDate: "2026-11-13",
      dueTime: "10:00",
      reason: "It starts with a verb (“call”), so it's something to do.",
    },
    {
      text: "Take bins out tonight 20:00",
      title: "Take bins out",
      dueDate: "2026-11-10",
      dueTime: "20:00",
    },
    { text: "Renew passport Friday", title: "Renew passport", dueDate: "2026-11-13" },
    {
      text: "Pick up parcel 5pm",
      title: "Pick up parcel",
      dueDate: "2026-11-10",
      dueTime: "17:00",
    },
    {
      text: "Parcel arrives 5pm",
      title: "Parcel arrives",
      dueDate: "2026-11-10",
      dueTime: "17:00",
      reason: "A time with no length is a reminder.",
    },
    {
      text: "Dentist Friday",
      title: "Dentist",
      dueDate: "2026-11-13",
      dueTime: undefined,
      reason: "A day with no time is a dated task.",
    },
    {
      text: "Pay rent",
      title: "Pay rent",
      dueDate: undefined,
      spans: [],
      reason: "It starts with a verb (“pay”), so it's something to do.",
    },
    {
      text: "New running shoes",
      title: "New running shoes",
      dueDate: undefined,
      reason: "No date or time, so it's a task for Someday.",
    },
  ])("$text", ({ text, ...expected }) => {
    expect(read(text)).toMatchObject({ kind: "reminder", ...expected });
  });
});

describe("parseCapture: times", () => {
  test.each([
    ["Lunch 12-1", "2026-11-10T12:00:00.000Z", "2026-11-10T13:00:00.000Z"],
    ["Lunch Thu 12-1", "2026-11-12T12:00:00.000Z", "2026-11-12T13:00:00.000Z"],
    ["Meeting 3-4pm", "2026-11-10T15:00:00.000Z", "2026-11-10T16:00:00.000Z"],
    ["Meeting from 9 to 10:30", "2026-11-10T09:00:00.000Z", "2026-11-10T10:30:00.000Z"],
    ["Lunch at noon", "2026-11-10T12:00:00.000Z", "2026-11-10T13:00:00.000Z"],
    ["Standup 10:00 for 15m", "2026-11-10T10:00:00.000Z", "2026-11-10T10:15:00.000Z"],
    ["Run 18:00 for 45 minutes", "2026-11-10T18:00:00.000Z", "2026-11-10T18:45:00.000Z"],
    ["Call mum at 3pm for half an hour", "2026-11-10T15:00:00.000Z", "2026-11-10T15:30:00.000Z"],
    ["Gym 7am for an hour", "2026-11-11T07:00:00.000Z", "2026-11-11T08:00:00.000Z"],
    ["Late shift 22:00-01:00", "2026-11-10T22:00:00.000Z", "2026-11-11T01:00:00.000Z"],
    ["Drinks with Jo at 6", "2026-11-10T18:00:00.000Z", "2026-11-10T19:00:00.000Z"],
  ])("%s", (text, start, end) => {
    expect(read(text)).toMatchObject({ kind: "event", start, end });
  });

  test("a time that has passed today means tomorrow", () => {
    expect(read("Gym 7am for 1h")?.start).toBe("2026-11-11T07:00:00.000Z");
    expect(read("Gym 9am for 1h")?.start).toBe("2026-11-10T09:00:00.000Z");
  });

  test("times are read in the given zone", () => {
    expect(read("Lunch 12-1", { timeZone: "America/Los_Angeles" })).toMatchObject({
      start: "2026-11-10T20:00:00.000Z",
      end: "2026-11-10T21:00:00.000Z",
    });
  });

  test("an event on the day the clocks go back uses the new offset", () => {
    // Saturday 24 October 2026 is BST (UTC+1); Sunday 25th is GMT.
    const saturday = new Date("2026-10-24T10:00:00Z");

    expect(read("Dentist tomorrow 10:00", { now: saturday })?.start).toBe(
      "2026-10-25T10:00:00.000Z",
    );
  });

  test("an event on the day the clocks go forward uses the new offset", () => {
    // Saturday 28 March 2026 is GMT; Sunday 29th is BST (UTC+1).
    const saturday = new Date("2026-03-28T10:00:00Z");

    expect(read("Gym tomorrow 7am for 1h", { now: saturday })).toMatchObject({
      start: "2026-03-29T06:00:00.000Z",
      end: "2026-03-29T07:00:00.000Z",
    });
  });
});

describe("parseCapture: places", () => {
  test.each([
    {
      text: "Lunch with Sam at Dishoom tomorrow 1pm",
      title: "Lunch with Sam",
      place: "Dishoom",
      spans: ["who:with Sam", "where:at Dishoom", "when:tomorrow 1pm"],
    },
    {
      text: "Dinner @Dishoom Shoreditch Fri 7pm",
      title: "Dinner",
      place: "Dishoom Shoreditch",
      spans: ["where:@Dishoom Shoreditch", "when:Fri 7pm"],
    },
    {
      text: "Coffee at the Barbican, Thu 3pm",
      title: "Coffee",
      place: "Barbican",
      spans: ["where:at the Barbican", "when:Thu 3pm"],
    },
    {
      text: "Drinks at Monmouth Coffee on Fri 6-8pm",
      title: "Drinks",
      place: "Monmouth Coffee",
      spans: ["where:at Monmouth Coffee", "when:on Fri 6-8pm"],
    },
  ])("$text", ({ text, title, place, spans }) => {
    const parse = parseCapture(text, { now, timeZone });

    expect(parse).toMatchObject({ kind: "event", title, place });
    expect(read(text)?.spans).toEqual([...spans]);
  });

  test("a time after at stays a time", () => {
    expect(parseCapture("Standup at 10 for 15m", { now, timeZone })?.place).toBeUndefined();
    expect(parseCapture("Meet at Noon tomorrow", { now, timeZone })?.place).toBeUndefined();
  });

  test("a place makes a timed line an event", () => {
    expect(read("Sam at Dishoom tomorrow 1pm")).toMatchObject({
      kind: "event",
      title: "Sam",
      reason: "It's at a place, so it's an event. It gets an hour.",
    });
  });

  test("a reminder keeps its place in the title", () => {
    const parse = parseCapture("Pick up parcel at Post Office Fri", { now, timeZone });

    expect(parse).toMatchObject({ kind: "reminder", title: "Pick up parcel at Post Office" });
    expect(parse?.place).toBeUndefined();
  });
});

describe("parseCapture: recurring", () => {
  test("a weekday rule repeats weekly from the next one", () => {
    expect(read("Gym every Monday 7am")).toMatchObject({
      kind: "reminder",
      title: "Gym",
      dueDate: "2026-11-16",
      dueTime: "07:00",
      recurrence: "every week",
      spans: ["when:every Monday 7am"],
      reason: "It repeats, so it's a reminder. Recurring events come later.",
    });
  });

  test("a rule with no day starts today", () => {
    expect(read("Water plants every day")).toMatchObject({
      title: "Water plants",
      dueDate: "2026-11-10",
      recurrence: "every day",
    });
  });

  test("an end time doesn't make a recurring line an event", () => {
    expect(read("Yoga every week 18:00-19:00")?.kind).toBe("reminder");
  });
});

describe("parseCapture: switched by hand", () => {
  test("an event switched to a reminder keeps its time as the due time", () => {
    expect(read("Coffee with Priya Thu 3pm", { kind: "reminder" })).toMatchObject({
      kind: "reminder",
      dueDate: "2026-11-12",
      dueTime: "15:00",
      reason: "Read as an event, switched by hand. The switch holds until the box is cleared.",
    });
  });

  test("a reminder switched to an event gets an hour at its time", () => {
    expect(read("Call dentist Fri 10:00", { kind: "event" })).toMatchObject({
      kind: "event",
      start: "2026-11-13T10:00:00.000Z",
      end: "2026-11-13T11:00:00.000Z",
      reason: "Read as a reminder, switched by hand. The switch holds until the box is cleared.",
    });
  });

  test("an event switched on with no time starts at 09:00 on its day", () => {
    expect(read("Dentist Friday", { kind: "event" })).toMatchObject({
      start: "2026-11-13T09:00:00.000Z",
      end: "2026-11-13T10:00:00.000Z",
    });
  });

  test("the same kind by hand keeps the rule's reason", () => {
    expect(read("Pay rent", { kind: "reminder" })?.reason).toBe(
      "It starts with a verb (“pay”), so it's something to do.",
    );
  });
});

describe("parseCapture: text", () => {
  test("a blank line is nothing", () => {
    expect(read("   ")).toBeUndefined();
  });

  test("the title drops a dangling at, on, from or by and starts with a capital", () => {
    expect(read("dinner with Alex at 7:30pm")?.title).toBe("Dinner with Alex");
    expect(read("submit expenses by Friday")?.title).toBe("Submit expenses");
  });

  test("numbers that aren't times stay in the title", () => {
    expect(read("Buy 2 apples")).toMatchObject({ title: "Buy 2 apples", spans: [] });
  });

  test("with needs a capitalised name", () => {
    expect(read("Lunch with leftovers 12:30")?.spans).toEqual(["when:12:30"]);
  });

  test("spans are UTF-16 offsets into the original text", () => {
    const text = "☕️ Coffee with Priya Thu 3pm";
    const parse = parseCapture(text, { now, timeZone });

    expect(parse?.spans.map((span) => text.slice(span.start, span.end))).toEqual([
      "with Priya",
      "Thu 3pm",
    ]);
  });
});
