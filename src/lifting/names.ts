// Which written names are the same exercise. Daily notes are typed by hand, so "Cable Fly
// Crossover" and "cable fly crossovers" must land on one history. docs/lifting.md has the rules.

/** "Pull-ups" → "pull up": no case, accents or punctuation, and a plural last word made singular. */
export function exerciseKey(name: string): string {
  const words = name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w !== "");
  const last = words.pop();
  return last === undefined ? "" : [...words, singular(last)].join(" ");
}

/** "Chest Press" → "chest-press", the exercise's name in addresses. */
export function exerciseSlug(title: string): string {
  return exerciseKey(title).replace(/ /g, "-");
}

/** Drops a plural "s" ("ups", "curls") but keeps a double one ("press"). */
function singular(word: string): string {
  return word.length > 2 && word.endsWith("s") && !word.endsWith("ss") ? word.slice(0, -1) : word;
}
