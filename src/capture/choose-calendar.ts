// Guesses which calendar a new event goes on. Shared by the web app (live, as you type) and
// the server (for the write), so both pick the same calendar from the same hints.

/** A calendar new events can go on. Read-only calendars are never in this list. */
export interface WritableCalendar {
  /** Resource name, e.g. "calendarAccounts/icloud/calendars/fitness". */
  name: string;
  displayName: string;
  /** "fitness" lets sport words find it without a rule. */
  category?: string;
}

/** How often past events with this title were on a calendar. */
export interface TitleHint {
  titleKey: string;
  calendar: string;
  count: number;
  /** ISO time of the newest such event, to break ties. */
  lastTime: string;
}

/** "gym, run, swim → Fitness". */
export interface KeywordRule {
  words: string[];
  calendar: string;
}

export interface CalendarHints {
  calendars: WritableCalendar[];
  defaultCalendar?: string;
  rules: KeywordRule[];
  titles: TitleHint[];
}

export interface CalendarGuess {
  calendar: string;
  /** For the preview line, e.g. "Physio is usually on Fitness." */
  reason: string;
}

/** Sports that go on a Fitness calendar when no rule or past title says otherwise. */
const FITNESS_WORDS = ["volleyball", "gym", "run", "swim", "yoga", "workout"];

/** Lower-case words only, so "Physio 10:00!" and "physio" match. */
export function titleKey(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^\p{L}\s]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * The calendar used most for a similar past title, else the first keyword rule that matches,
 * else a Fitness calendar for a sport, else the default calendar, else the first writable one. Undefined when nothing is writable.
 */
export function chooseCalendar(title: string, hints: CalendarHints): CalendarGuess | undefined {
  const writable = new Map(hints.calendars.map((calendar) => [calendar.name, calendar]));
  const displayName = (name: string) => writable.get(name)?.displayName ?? name;
  const fromHistory = fromPastTitles(title, hints.titles, writable);
  if (fromHistory) {
    const said = capitalize(fromHistory.phrase);
    return {
      calendar: fromHistory.calendar,
      reason: `${said} is usually on ${displayName(fromHistory.calendar)}.`,
    };
  }
  const rule = fromRules(title, hints.rules, writable);
  if (rule) {
    return {
      calendar: rule.calendar,
      reason: `Your rule “${rule.word}” puts it on ${displayName(rule.calendar)}.`,
    };
  }
  const sport = fromSportWords(title, hints.calendars);
  if (sport) {
    return {
      calendar: sport.calendar.name,
      reason: `${capitalize(sport.word)} goes on ${sport.calendar.displayName}.`,
    };
  }
  if (hints.defaultCalendar && writable.has(hints.defaultCalendar)) {
    return { calendar: hints.defaultCalendar, reason: "Your default calendar." };
  }
  const [first] = hints.calendars;
  if (!first) {
    return undefined;
  }
  return { calendar: first.name, reason: "The first calendar you can add to." };
}

function fromPastTitles(
  title: string,
  titles: TitleHint[],
  writable: Map<string, WritableCalendar>,
): { calendar: string; phrase: string } | undefined {
  const key = titleKey(title);
  const firstWord = key.split(" ")[0] ?? "";
  if (!firstWord) {
    return undefined;
  }
  const exact = titles.filter((hint) => hint.titleKey === key);
  const matches =
    exact.length > 0 ? exact : titles.filter((hint) => hint.titleKey.split(" ")[0] === firstWord);
  const calendar = mostUsed(matches.filter((hint) => writable.has(hint.calendar)));
  if (!calendar) {
    return undefined;
  }
  return { calendar, phrase: exact.length > 0 ? key : firstWord };
}

/** The calendar with the most matching events; ties go to the one used most recently. */
function mostUsed(hints: TitleHint[]): string | undefined {
  const totals = new Map<string, { count: number; lastTime: string }>();
  for (const hint of hints) {
    const total = totals.get(hint.calendar) ?? { count: 0, lastTime: "" };
    total.count += hint.count;
    total.lastTime = hint.lastTime > total.lastTime ? hint.lastTime : total.lastTime;
    totals.set(hint.calendar, total);
  }
  const ranked = [...totals].sort(
    ([, a], [, b]) => b.count - a.count || b.lastTime.localeCompare(a.lastTime),
  );
  return ranked[0]?.[0];
}

function fromRules(
  title: string,
  rules: KeywordRule[],
  writable: Map<string, WritableCalendar>,
): { calendar: string; word: string } | undefined {
  // Padded with spaces so "run" matches "Morning run" but not "Brunch", and "stand up" works.
  const padded = ` ${titleKey(title)} `;
  for (const rule of rules) {
    const word = rule.words.find((candidate) => {
      const key = titleKey(candidate);
      return key !== "" && padded.includes(` ${key} `);
    });
    if (word && writable.has(rule.calendar)) {
      return { calendar: rule.calendar, word };
    }
  }
  return undefined;
}

function fromSportWords(
  title: string,
  calendars: WritableCalendar[],
): { calendar: WritableCalendar; word: string } | undefined {
  const calendar = calendars.find((c) => c.category === "fitness");
  const words = titleKey(title).split(" ");
  const word = FITNESS_WORDS.find((w) => words.includes(w));
  return calendar && word ? { calendar, word } : undefined;
}

function capitalize(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
