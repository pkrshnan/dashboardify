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

- Meditate <!-- id:meditate -->
\t- schedule: daily
- Lift <!-- id:lift -->
\t- schedule: 3 a week
\t- auto: lifting
\t- colour: 40C8E0
- Lights out <!-- id:lights-out -->
\t- schedule: Sun Mon Tue Wed Thu
\t- auto: lights_out ≤ 23:30
- Read
\t- schedule: daily
\t- since: 2026-09-01
\t- from a book club
\t- status: paused
- [ ] Not a habit, a task
  - an indented note

Some words of my own.
`;

describe("parseHabits", () => {
  test("reads each habit with its schedule, rule, colour and state", () => {
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

  test("names a habit without an id by its slug", () => {
    const read = parseHabits(HABITS).find((h) => h.name === "Read");

    expect(read?.id).toBe("read");
    expect(read?.since).toBe("2026-09-01");
  });

  test("reads keys in any case, a colour with or without #, and skips bad values", () => {
    const [habit] = parseHabits(
      "- Floss\n\t- Schedule: Mon Wed\n\t- COLOUR: #66d4cf\n\t- since: soon\n\t- status: maybe\n",
    );

    expect(habit).toMatchObject({
      schedule: { kind: "days", days: [1, 3] },
      color: "#66D4CF",
      since: null,
      state: "active",
    });
  });

  test("a name may hold ·", () => {
    expect(parseHabits("- Read · fiction <!-- id:read -->\n")[0]?.name).toBe("Read · fiction");
  });

  test("skips checkboxes, indented lines and empty names", () => {
    expect(parseHabits("- [x] Done thing\n  - Indented\n- <!-- id:x -->\n")).toEqual([]);
  });

  test("gives a second line with the same id its own", () => {
    const ids = parseHabits("- Read\n- read\n- Read <!-- id:read -->\n").map((h) => h.id);

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
  const fields = { auto: null, color: null, since: null, state: "active" as const };

  test("adds a habit after the last one and its bullets, keeping every other line", () => {
    const added = "- Run <!-- id:run -->\n\t- schedule: 2 a week\n\t- colour: 66D4CF\n";
    const { text, habit } = addHabit(HABITS, {
      ...fields,
      name: "Run",
      schedule: { kind: "weekly", times: 2 },
      color: "#66D4CF",
    });

    expect(habit.id).toBe("run");
    expect(text).toContain(`\t- status: paused\n${added}- [ ]`);
    expect(text.replace(added, "")).toBe(HABITS);
  });

  test("puts the first habit after a blank line and never reuses an id", () => {
    const daily = { ...fields, schedule: { kind: "daily" as const } };
    const first = addHabit("# Habits\n", { ...daily, name: "Read" });
    const second = addHabit(first.text, { ...daily, name: "read" });

    expect(first.text).toBe("# Habits\n\n- Read <!-- id:read -->\n\t- schedule: daily\n");
    expect(second.habit.id).toBe("read-2");
  });

  test("a rename writes the id, rewrites only its own fields and keeps other bullets", () => {
    const renamed = updateHabit(HABITS, "read", { name: "Read fiction", state: "active" });
    const again = parseHabits(renamed?.text ?? "").find((h) => h.name === "Read fiction");

    expect(again?.id).toBe("read");
    expect(renamed?.text).toContain(
      "- Read fiction <!-- id:read -->\n\t- schedule: daily\n\t- since: 2026-09-01\n\t- from a book club\n- [ ]",
    );
    expect(updateHabit(HABITS, "nope", { name: "x" })).toBeNull();
  });

  test("a habit round-trips through habitLines", () => {
    for (const habit of parseHabits(HABITS)) {
      expect(parseHabits(habitLines(habit).join("\n"))[0]).toEqual({ ...habit, line: 0 });
    }
  });

  test("picks the next colour no habit has", () => {
    expect(nextColor(parseHabits(HABITS))).toBe("#BF5AF2");
    expect(nextColor(parseHabits("- A\n\t- colour: BF5AF2\n"))).toBe("#40C8E0");
  });

  test("refuses names that would break the line", () => {
    expect(["Read", "Bed by 23:30", "Read · fiction"].every(isValidName)).toBe(true);
    expect(["", "  ", "x <!-- y", "a\nb"].some(isValidName)).toBe(false);
  });
});
