// Siri's "add to list": which list was meant, what the items are, and the sentence to speak.
// Pure; VoiceService.addToList reads and writes through the list services.

import { type ListSummary, slugOf } from "../lists/list-store";

/**
 * The list a spoken name means: "shopping", "the shopping list", "Shopping" all find Shopping.
 * An exact name wins, then one that starts with it, then one that contains it.
 */
export function findList(spoken: string, lists: ListSummary[]): ListSummary | undefined {
  const name = slugOf(
    spoken
      .trim()
      .replace(/^(the|my)\s+/i, "")
      .replace(/\s+list$/i, ""),
  );
  return (
    lists.find((list) => list.slug === name) ??
    lists.find((list) => list.slug.startsWith(name)) ??
    lists.find((list) => list.slug.includes(name))
  );
}

/**
 * What was said, as items. Commas always separate. Dictation rarely puts commas in, so "and"
 * separates too, unless the whole phrase is something already on the list: "mac and cheese"
 * you've bought before stays one item.
 */
export function spokenEntries(text: string, known: string[]): string[] {
  const onList = new Set(known.map((item) => item.toLowerCase()));
  return text
    .split(",")
    .map((part) => part.trim())
    .filter((part) => part !== "")
    .flatMap((part) => (onList.has(part.toLowerCase()) ? [part] : part.split(/\s+and\s+/i)))
    .map((part) => part.trim())
    .filter((part) => part !== "");
}

/** "Added oat milk and eggs to Shopping. Bread was already on it." */
export function addedSentence(list: string, added: string[], already: string[]): string {
  const parts: string[] = [];
  if (added.length > 0) {
    parts.push(`Added ${joined(added)} to ${list}.`);
  }
  if (already.length > 0) {
    const verb = already.length === 1 ? "was" : "were";
    const where = added.length > 0 ? "it" : list;
    parts.push(`${capitalised(joined(already))} ${verb} already on ${where}.`);
  }
  return parts.join(" ");
}

/** "There's no list called films. Your lists are Shopping and Packing." */
export function noListSentence(spoken: string, lists: ListSummary[]): string {
  const yours = lists.length > 0 ? ` Your lists are ${joined(lists.map((l) => l.title))}.` : "";
  return `There's no list called ${spoken.trim()}.${yours}`;
}

/** "a", "a and b", "a, b and c". */
function joined(items: string[]): string {
  if (items.length <= 1) {
    return items.join("");
  }
  return `${items.slice(0, -1).join(", ")} and ${items.at(-1)}`;
}

function capitalised(text: string): string {
  return text.charAt(0).toUpperCase() + text.slice(1);
}
