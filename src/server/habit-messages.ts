// Siri's "did a habit": which habit was meant, which day, and the sentence to speak. Pure;
// VoiceService.tickHabit reads and writes through HabitsService.

/** Words that say nothing about which habit: "I just did my meditation today". */
const FILLER = new Set([
  "i",
  "just",
  "did",
  "done",
  "finished",
  "my",
  "the",
  "a",
  "an",
  "some",
  "today",
  "tonight",
  "yesterday",
  "last",
  "night",
  "went",
  "for",
]);
const MIN_STEM = 3;

export interface SpokenHabit {
  name: string;
  displayName: string;
}

/**
 * The habit "I meditated", "flossed" or "did my reading" means: every word of its name matches a
 * word said, ignoring endings, and the longest such name wins.
 */
export function findHabit<T extends SpokenHabit>(spoken: string, habits: T[]): T | undefined {
  const said = words(spoken).filter((w) => !FILLER.has(w));
  const matching = habits.filter((habit) => {
    const name = words(habit.displayName);
    return name.length > 0 && name.every((word) => said.some((s) => sameWord(word, s)));
  });
  return matching.sort((a, b) => words(b.displayName).length - words(a.displayName).length)[0];
}

/** "Yesterday" or "last night" ticks the day before; anything else, today. */
export function spokenDaysBack(spoken: string): number {
  return /\b(yesterday|last night)\b/i.test(spoken) ? 1 : 0;
}

/** "Ticked Meditate. 12 days." or, weekly, "Ticked Lift. 2 of 3 this week." */
export function tickedSentence(
  displayName: string,
  progress: { streak?: number; unit?: string; thisWeek?: number },
  timesPerWeek: number | undefined,
  daysBack: number,
): string {
  const when = daysBack > 0 ? " for yesterday" : "";
  if (timesPerWeek !== undefined) {
    return `Ticked ${displayName}${when}. ${progress.thisWeek ?? 0} of ${timesPerWeek} this week.`;
  }
  const streak = progress.streak ?? 0;
  return `Ticked ${displayName}${when}. ${streak} ${streak === 1 ? "day" : "days"}.`;
}

/** "There's no habit called juggling. Your habits are Meditate and Read." */
export function noHabitSentence(spoken: string, habits: SpokenHabit[]): string {
  const names = habits.map((h) => h.displayName);
  const yours = names.length > 0 ? ` Your habits are ${joined(names)}.` : "";
  return `There's no habit called ${spoken.trim()}.${yours}`;
}

function words(text: string): string[] {
  return text
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .split(/[^a-z0-9]+/)
    .filter((w) => w !== "");
}

/** "meditate" and "meditated", "floss" and "flossed", "lift" and "lifting". */
function sameWord(a: string, b: string): boolean {
  const [x, y] = [stem(a), stem(b)];
  const shorter = x.length <= y.length ? x : y;
  const longer = shorter === x ? y : x;
  return shorter.length >= MIN_STEM ? longer.startsWith(shorter) : x === y;
}

function stem(word: string): string {
  return word.replace(/(ing|ed|es|e|s)$/, "");
}

function joined(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}
