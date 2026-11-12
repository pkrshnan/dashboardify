import { describe, expect, test } from "bun:test";
import {
  addHabit,
  habitLine,
  isValidName,
  nextColor,
  parseHabits,
  parseSchedule,
  updateHabit,
} from "../../src/habits/habit-note";

const HABITS = `# Habits

Things I mean to do.

- Meditate · daily <!-- id:meditate -->
- Lift · 3 a week · auto lifting · #40C8E0 <!-- id:lift -->
- Lights out · Sun Mon Tue Wed Thu · auto lights_out ≤ 23:30 <!-- id:lights-out -->
- Read · daily · paused · since spring
- [ ] Not a habit, a task
  - an indented note

Some words of my own.
`;

describe("parseHabits", () => {
  test("reads each habit line with its schedule, rule, colour and state", () => {
    const habits = parseHabits(HABITS);

    expect(habits.map((h) => [h.id, h.name, h.schedule, h.auto, h.color, h.state])).toEqual([
      ["meditate", "Meditate", { kind: "daily" }, null, null, "active"],
      ["lift", "Lift", { kind: "weekly", times: 3 }, "lifting", "#40C8E0", "active"],
      [
        "lights-out",
        "Lights out",
        { kind: "days", days: [1, 2, 3, 4, 7] },
        "lights_out ≤ 23:30",
        null,
        "active",
      ],
      ["read", "Read", { kind: "daily" }, null, null, "paused"],
    ]);
  });

  test("names a line without an id by its slug and keeps fields it doesn't know", () => {
    const read = parseHabits(HABITS).find((h) => h.name === "Read");

    expect(read?.id).toBe("read");
    expect(read?.extra).toEqual(["since spring"]);
  });

  test("skips checkboxes, indented lines and empty names", () => {
    expect(parseHabits("- [x] Done thing\n  - Indented\n- · daily\n")).toEqual([]);
  });

  test("gives a second line with the same id its own", () => {
    const ids = parseHabits("- Read\n- read · daily\n- Read <!-- id:read -->\n").map((h) => h.id);

    expect(ids).toEqual(["read", "read-2", "read-3"]);
  });
});

describe("parseSchedule", () => {
  test("reads every way a schedule is written", () => {
    expect(parseSchedule("every day")).toEqual({ kind: "daily" });
    expect(parseSchedule("3× a week")).toEqual({ kind: "weekly", times: 3 });
    expect(parseSchedule("2 times a week")).toEqual({ kind: "weekly", times: 2 });
    expect(parseSchedule("Fri mon, wed")).toEqual({ kind: "days", days: [1, 3, 5] });
    expect(parseSchedule("8 a week")).toBeNull();
    expect(parseSchedule("Mon Funday")).toBeNull();
  });
});

describe("editing", () => {
  test("adds a habit after the last one, keeping every other line", () => {
    const { text, habit } = addHabit(HABITS, {
      name: "Floss",
      schedule: { kind: "days", days: [1, 3] },
      auto: null,
      color: "#66D4CF",
      state: "active",
      extra: [],
    });

    expect(habit.id).toBe("floss");
    expect(text).toContain(
      "- Read · daily · paused · since spring\n- Floss · Mon Wed · #66D4CF <!-- id:floss -->\n- [ ]",
    );
    expect(text.replace("- Floss · Mon Wed · #66D4CF <!-- id:floss -->\n", "")).toBe(HABITS);
  });

  test("puts the first habit after a blank line and never reuses an id", () => {
    const fields = { schedule: { kind: "daily" as const }, auto: null, color: null };
    const first = addHabit("# Habits\n", { ...fields, name: "Read", state: "active", extra: [] });
    const second = addHabit(first.text, { ...fields, name: "read", state: "active", extra: [] });

    expect(first.text).toBe("# Habits\n\n- Read · daily <!-- id:read -->\n");
    expect(second.habit.id).toBe("read-2");
  });

  test("a rename writes the id, so the habit keeps its history", () => {
    const renamed = updateHabit(HABITS, "read", { name: "Read fiction" });
    const again = parseHabits(renamed?.text ?? "").find((h) => h.name === "Read fiction");

    expect(again?.id).toBe("read");
    expect(renamed?.text).toContain(
      "- Read fiction · daily · paused · since spring <!-- id:read -->\n",
    );
    expect(updateHabit(HABITS, "nope", { name: "x" })).toBeNull();
  });

  test("a line round-trips through habitLine", () => {
    for (const habit of parseHabits(HABITS).slice(0, 3)) {
      expect(parseHabits(habitLine(habit))[0]).toEqual({ ...habit, line: 0 });
    }
  });

  test("picks the next colour no habit has", () => {
    expect(nextColor(parseHabits(HABITS))).toBe("#BF5AF2");
    expect(nextColor(parseHabits("- A · #BF5AF2\n"))).toBe("#40C8E0");
  });

  test("refuses names that would break the line", () => {
    expect(["Read", "Bed by 23:30"].every(isValidName)).toBe(true);
    expect(["", "  ", "a · b", "x <!-- y", "a\nb"].some(isValidName)).toBe(false);
  });
});
