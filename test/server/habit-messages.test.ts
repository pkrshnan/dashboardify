import { describe, expect, test } from "bun:test";
import {
  findHabit,
  noHabitSentence,
  spokenDaysBack,
  tickedSentence,
} from "../../src/server/habit-messages";

const HABITS = [
  { name: "habits/meditate", displayName: "Meditate" },
  { name: "habits/floss", displayName: "Floss" },
  { name: "habits/read", displayName: "Read" },
  { name: "habits/lights-out", displayName: "Lights out" },
  { name: "habits/read-fiction", displayName: "Read fiction" },
];

describe("findHabit", () => {
  test("finds the habit whatever the ending and the words around it", () => {
    const found = (said: string) => findHabit(said, HABITS)?.name;

    expect(found("I meditated")).toBe("habits/meditate");
    expect(found("flossed")).toBe("habits/floss");
    expect(found("Just did my meditation today")).toBe("habits/meditate");
    expect(found("lights out last night")).toBe("habits/lights-out");
  });

  test("the longest name that fits wins", () => {
    expect(findHabit("read some fiction", HABITS)?.name).toBe("habits/read-fiction");
    expect(findHabit("I read", HABITS)?.name).toBe("habits/read");
  });

  test("finds nothing for a habit that isn't there", () => {
    expect(findHabit("juggled", HABITS)).toBeUndefined();
    expect(findHabit("I did it", HABITS)).toBeUndefined();
  });
});

describe("sentences", () => {
  test("yesterday and last night tick the day before", () => {
    expect(spokenDaysBack("read last night")).toBe(1);
    expect(spokenDaysBack("Flossed yesterday")).toBe(1);
    expect(spokenDaysBack("meditated")).toBe(0);
  });

  test("speaks back the streak, or this week for a weekly habit", () => {
    expect(tickedSentence("Meditate", { streak: 12 }, undefined, 0)).toBe(
      "Ticked Meditate. 12 days.",
    );
    expect(tickedSentence("Read", { streak: 1 }, undefined, 1)).toBe(
      "Ticked Read for yesterday. 1 day.",
    );
    expect(tickedSentence("Lift", { thisWeek: 2 }, 3, 0)).toBe("Ticked Lift. 2 of 3 this week.");
  });

  test("names the habits there are when none matches", () => {
    expect(noHabitSentence("juggling ", HABITS.slice(0, 2))).toBe(
      "There's no habit called juggling. Your habits are Meditate and Floss.",
    );
  });
});
