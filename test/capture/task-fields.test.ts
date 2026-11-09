import { describe, expect, test } from "bun:test";
import { parseCapture } from "../../src/capture/parse";
import { taskFields } from "../../src/capture/task-fields";

// Tuesday 10 November 2026, 08:00 in London.
const context = { now: new Date("2026-11-10T08:00:00Z"), timeZone: "Europe/London" };

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
