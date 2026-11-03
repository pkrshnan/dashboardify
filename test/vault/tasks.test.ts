import { describe, expect, test } from "bun:test";
import { formatTask, nextDue, parseTaskLine } from "../../src/vault/tasks";
import { parseWhen } from "../../src/vault/when";

describe("parseTaskLine", () => {
  test("reads Tasks fields in any order, plus our ⏰ time", () => {
    const task = parseTaskLine(
      "- [ ] Call the bank ⏰ 09:00 📅 2026-11-03 ⏫ 🆔 k7f3a2 ➕ 2026-11-02",
    );
    expect(task).toEqual({
      done: false,
      description: "Call the bank",
      time: "09:00",
      due: "2026-11-03",
      priority: "high",
      id: "k7f3a2",
      created: "2026-11-02",
    });
  });

  test("ignores lines that aren't tasks", () => {
    expect(parseTaskLine("- plain bullet")).toBeNull();
    expect(parseTaskLine("Some text")).toBeNull();
  });

  test("any status other than space counts as done", () => {
    expect(parseTaskLine("- [x] Done ✅ 2026-11-01")?.done).toBe(true);
    expect(parseTaskLine("- [-] Cancelled")?.done).toBe(true);
  });

  test("keeps emoji in the middle of the description", () => {
    expect(parseTaskLine("- [ ] Buy 📅 calendar for desk")?.description).toBe(
      "Buy 📅 calendar for desk",
    );
  });
});

describe("formatTask", () => {
  test("round-trips, with ⏰ right after the description", () => {
    const line =
      "- [ ] Call the bank ⏰ 09:00 ⏫ 🔁 every week 📅 2026-11-03 ➕ 2026-11-02 🆔 k7f3a2";
    const task = parseTaskLine(line);
    expect(task && formatTask(task)).toBe(line);
  });

  test("keeps indentation", () => {
    expect(formatTask({ done: true, description: "Sub" }, "  ")).toBe("  - [x] Sub");
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
