import { describe, expect, test } from "bun:test";
import { guessCategory } from "../../src/calendar/accounts";

describe("guessCategory", () => {
  test("guesses from the calendar's name, and falls back to personal", () => {
    expect(guessCategory("Work")).toBe("work");
    expect(guessCategory("Gym")).toBe("fitness");
    expect(guessCategory("Family")).toBe("family");
    expect(guessCategory("Kids' school")).toBe("family");
    expect(guessCategory("Date night")).toBe("relationships");
    expect(guessCategory("Partner")).toBe("relationships");
    expect(guessCategory("Update")).toBe("personal");
    expect(guessCategory("Home")).toBe("personal");
  });
});
