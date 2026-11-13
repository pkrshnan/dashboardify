import { describe, expect, test } from "bun:test";
import { formatTask, nextDue, parseTask, parseTaskLine } from "../../src/vault/tasks";
import { parseWhen } from "../../src/vault/when";

describe("parseTask", () => {
  test("reads the line and its fields", () => {
    const lines = [
      "- [ ] Call the bank <!-- id:k7f3a2 -->",
      "\t- due: 2026-11-03 09:00",
      "\t- repeat: every week",
      "\t- Priority: High",
      "\t- ask about fees",
    ];
    expect(parseTask(lines, 0)).toEqual({
      done: false,
      description: "Call the bank",
      time: "09:00",
      due: "2026-11-03",
      recurrence: "every week",
      priority: "high",
      id: "k7f3a2",
    });
  });

  test("a done task reads its done date", () => {
    expect(parseTask(["- [x] Fold laundry", "\t- done: 2026-11-11"], 0)?.completed).toBe(
      "2026-11-11",
    );
  });

  test("skips values it can't read", () => {
    const lines = ["- [ ] A", "\t- due: Friday", "\t- priority: urgent", "\t- done: soon"];
    expect(parseTask(lines, 0)).toEqual({ done: false, description: "A" });
  });
});

describe("parseTaskLine", () => {
  test("reads the text and id", () => {
    expect(parseTaskLine("- [ ] Call the bank <!-- id:k7f3a2 -->")).toEqual({
      done: false,
      description: "Call the bank",
      id: "k7f3a2",
    });
  });

  test("ignores lines that aren't tasks", () => {
    expect(parseTaskLine("- plain bullet")).toBeNull();
    expect(parseTaskLine("Some text")).toBeNull();
  });

  test("any status other than space counts as done", () => {
    expect(parseTaskLine("- [x] Done")?.done).toBe(true);
    expect(parseTaskLine("- [-] Cancelled")?.done).toBe(true);
  });

  test("keeps emoji in the description", () => {
    expect(parseTaskLine("- [ ] Buy 📅 calendar ⏫")?.description).toBe("Buy 📅 calendar ⏫");
  });
});

describe("formatTask", () => {
  test("round-trips, with the id on the line and the details as fields", () => {
    const lines = [
      "- [x] Call Fetch <!-- id:a7efea -->",
      "\t- due: 2026-11-04",
      "\t- done: 2026-11-09",
    ];
    const task = parseTask(lines, 0);
    expect(task && formatTask(task)).toEqual(lines);
  });

  test("keeps indentation and leaves out the done date of an open task", () => {
    expect(formatTask({ done: false, description: "Sub", completed: "2026-11-01" }, "  ")).toEqual([
      "  - [ ] Sub",
    ]);
  });
});

describe("nextDue", () => {
  test("handles the common rules", () => {
    expect(nextDue("every day", "2026-11-03")).toBe("2026-11-04");
    expect(nextDue("every 2 weeks", "2026-11-03")).toBe("2026-11-17");
    expect(nextDue("every month", "2026-01-31")).toBe("2026-02-28");
    expect(nextDue("every weekday", "2026-11-06")).toBe("2026-11-09");
  });

  test("returns null for rules it doesn't know", () => {
    expect(nextDue("every month on the last friday", "2026-11-03")).toBeNull();
  });
});

describe("parseWhen", () => {
  const now = new Date("2026-11-02T18:00:00Z");
  const zone = "America/Los_Angeles";

  test("takes the date and time out of the text", () => {
    expect(parseWhen("Call the bank tomorrow at 9am", now, zone)).toEqual({
      description: "Call the bank",
      due: "2026-11-03",
      time: "09:00",
    });
  });

  test("a day without a time sets no time", () => {
    expect(parseWhen("pay rent on Friday", now, zone)).toEqual({
      description: "pay rent",
      due: "2026-11-06",
      time: undefined,
    });
  });

  test("text without a date is left alone", () => {
    expect(parseWhen("buy milk", now, zone)).toEqual({ description: "buy milk" });
  });

  test("uses the local day, not UTC", () => {
    // 07:30 UTC on Nov 3 is still Nov 2 in Los Angeles.
    expect(parseWhen("water plants tomorrow", new Date("2026-11-03T07:30:00Z"), zone).due).toBe(
      "2026-11-03",
    );
  });
});
