import { describe, expect, test } from "bun:test";
import {
  addHabit,
  habitLines,
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
- Read · daily · since 2026-09-01 · paused · from a book club
- Floss <!-- id:floss -->
	- schedule: Mon Wed
	- Colour: #66d4cf
	- with the new picks
	- status: paused
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
      ["floss", "Floss", { kind: "days", days: [1, 3] }, null, "#66D4CF", "paused"],
    ]);
  });

  test("a field wins over the same detail on an old line, and bad values are skipped", () => {
    const [habit] = parseHabits("- Read · 3 a week\n\t- schedule: daily\n\t- since: soon\n");

    expect(habit?.schedule).toEqual({ kind: "daily" });
    expect(habit?.since).toBeNull();
  });

  test("names a line without an id by its slug and keeps fields it doesn't know", () => {
    const read = parseHabits(HABITS).find((h) => h.name === "Read");

    expect(read?.id).toBe("read");
    expect(read?.since).toBe("2026-09-01");
    expect(read?.extra).toEqual(["from a book club"]);
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
  const FlossAndNote =
    "- Floss <!-- id:floss -->\n\t- schedule: Mon Wed\n\t- Colour: #66d4cf\n\t- with the new picks\n\t- status: paused\n";

  test("adds a habit after the last one and its bullets, keeping every other line", () => {
    const added = "- Run <!-- id:run -->\n\t- schedule: 2 a week\n\t- colour: 66D4CF\n";
    const { text, habit } = addHabit(HABITS, {
      name: "Run",
      schedule: { kind: "weekly", times: 2 },
      auto: null,
      color: "#66D4CF",
      since: null,
      state: "active",
      extra: [],
    });

    expect(habit.id).toBe("run");
    expect(text).toContain(`${FlossAndNote}${added}- [ ]`);
    expect(text.replace(added, "")).toBe(HABITS);
  });

  test("puts the first habit after a blank line and never reuses an id", () => {
    const fields = { schedule: { kind: "daily" as const }, auto: null, color: null, since: null };
    const first = addHabit("# Habits\n", { ...fields, name: "Read", state: "active", extra: [] });
    const second = addHabit(first.text, { ...fields, name: "read", state: "active", extra: [] });

    expect(first.text).toBe("# Habits\n\n- Read <!-- id:read -->\n\t- schedule: daily\n");
    expect(second.habit.id).toBe("read-2");
  });

  test("a rename rewrites an old line with its id and keeps unknown words as bullets", () => {
    const renamed = updateHabit(HABITS, "read", { name: "Read fiction" });
    const again = parseHabits(renamed?.text ?? "").find((h) => h.name === "Read fiction");

    expect(again?.id).toBe("read");
    expect(renamed?.text).toContain(
      "- Read fiction <!-- id:read -->\n\t- schedule: daily\n\t- since: 2026-09-01\n\t- status: paused\n\t- from a book club\n- Floss",
    );
    expect(updateHabit(HABITS, "nope", { name: "x" })).toBeNull();
  });

  test("an update rewrites only its own fields and keeps other bullets", () => {
    const resumed = updateHabit(HABITS, "floss", { state: "active" });

    expect(resumed?.text).toContain(
      "- Floss <!-- id:floss -->\n\t- schedule: Mon Wed\n\t- colour: 66D4CF\n\t- with the new picks\n- [ ]",
    );
  });

  test("a habit round-trips through habitLines", () => {
    for (const habit of parseHabits(HABITS).slice(0, 3)) {
      expect(parseHabits(habitLines(habit).join("\n"))[0]).toEqual({ ...habit, line: 0 });
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
