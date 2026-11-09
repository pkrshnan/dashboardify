import { describe, expect, test } from "bun:test";
import { type CalendarHints, chooseCalendar, titleKey } from "../../src/capture/choose-calendar";

const personal = "calendarAccounts/icloud/calendars/personal";
const work = "calendarAccounts/icloud/calendars/work";
const fitness = "calendarAccounts/icloud/calendars/fitness";
const shared = "calendarAccounts/icloud/calendars/dinners";

function hints(overrides: Partial<CalendarHints> = {}): CalendarHints {
  return {
    calendars: [
      { name: personal, displayName: "Personal" },
      { name: work, displayName: "Work" },
      { name: fitness, displayName: "Fitness" },
    ],
    defaultCalendar: personal,
    rules: [{ words: ["gym", "run", "swim"], calendar: fitness }],
    titles: [],
    ...overrides,
  };
}

describe("titleKey", () => {
  test("keeps lower-case words only", () => {
    expect(titleKey("Physio, 10:00!")).toBe("physio");
    expect(titleKey("  Design   Review ")).toBe("design review");
  });
});

describe("chooseCalendar", () => {
  test("a past event with the same title wins", () => {
    const titles = [
      { titleKey: "physio", calendar: fitness, count: 6, lastTime: "2026-11-01T09:00:00Z" },
      { titleKey: "physio", calendar: personal, count: 1, lastTime: "2026-10-01T09:00:00Z" },
    ];

    expect(chooseCalendar("Physio", hints({ titles }))).toEqual({
      calendar: fitness,
      reason: "Physio is usually on Fitness.",
    });
  });

  test("otherwise a past title with the same first word counts", () => {
    const titles = [
      { titleKey: "design review", calendar: work, count: 3, lastTime: "2026-11-01T09:00:00Z" },
      { titleKey: "design crit", calendar: work, count: 2, lastTime: "2026-11-02T09:00:00Z" },
    ];

    expect(chooseCalendar("Design sync", hints({ titles }))).toEqual({
      calendar: work,
      reason: "Design is usually on Work.",
    });
  });

  test("a tie goes to the calendar used most recently", () => {
    const titles = [
      { titleKey: "lunch", calendar: personal, count: 2, lastTime: "2026-10-01T12:00:00Z" },
      { titleKey: "lunch", calendar: work, count: 2, lastTime: "2026-11-05T12:00:00Z" },
    ];

    expect(chooseCalendar("Lunch", hints({ titles }))?.calendar).toBe(work);
  });

  test("history on a read-only calendar is skipped", () => {
    const titles = [
      { titleKey: "dinner", calendar: shared, count: 9, lastTime: "2026-11-05T19:00:00Z" },
    ];

    expect(chooseCalendar("Dinner", hints({ titles }))).toEqual({
      calendar: personal,
      reason: "Your default calendar.",
    });
  });

  test("then the first keyword rule that matches a whole word", () => {
    expect(chooseCalendar("Morning run", hints())).toEqual({
      calendar: fitness,
      reason: "Your rule “run” puts it on Fitness.",
    });
    expect(chooseCalendar("Brunch", hints())?.calendar).toBe(personal);
  });

  test("a rule can be more than one word", () => {
    const rules = [{ words: ["stand up"], calendar: work }];

    expect(chooseCalendar("Team stand up", hints({ rules }))?.calendar).toBe(work);
  });

  test("a rule pointing at a read-only calendar is skipped", () => {
    const rules = [{ words: ["dinner"], calendar: shared }];

    expect(chooseCalendar("Dinner", hints({ rules }))?.calendar).toBe(personal);
  });

  test("then a sport goes on the calendar whose category is fitness", () => {
    const calendars = [
      { name: personal, displayName: "Personal", category: "personal" },
      { name: shared, displayName: "Training", category: "fitness" },
    ];

    expect(chooseCalendar("Volleyball at the park", hints({ calendars, rules: [] }))).toEqual({
      calendar: shared,
      reason: "Volleyball goes on Training.",
    });
  });

  test("your own rule beats the built-in sports", () => {
    const calendars = [
      { name: personal, displayName: "Personal", category: "personal" },
      { name: fitness, displayName: "Fitness", category: "fitness" },
    ];
    const rules = [{ words: ["volleyball"], calendar: personal }];

    expect(chooseCalendar("Volleyball", hints({ calendars, rules }))?.calendar).toBe(personal);
  });

  test("a sport with no fitness calendar goes on the default", () => {
    expect(chooseCalendar("Volleyball", hints({ rules: [] }))?.calendar).toBe(personal);
  });

  test("with no default, the first writable calendar", () => {
    expect(chooseCalendar("Dentist", hints({ defaultCalendar: undefined }))).toEqual({
      calendar: personal,
      reason: "The first calendar you can add to.",
    });
  });

  test("a default that isn't writable is ignored", () => {
    expect(chooseCalendar("Dentist", hints({ defaultCalendar: shared }))?.calendar).toBe(personal);
  });

  test("nothing when no calendar is writable", () => {
    expect(chooseCalendar("Dentist", hints({ calendars: [] }))).toBeUndefined();
  });
});
