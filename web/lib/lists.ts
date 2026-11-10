// What the Lists page shows of a list: what's left, by section, and what's done. The wording
// fits any list (shopping, packing, films), so it says "left" and "done", not "to get" and "got".
// Pure, so it's tested without a DOM; web/modules/lists.tsx draws it.

import type { ListItemView, ListView } from "../api";

export interface Section {
  /** "" for the items before the list's first heading. */
  title: string;
  items: ListItemView[];
}

/** The list with ticks made in this session shown before the server confirms them. */
export function withTicks(list: ListView, ticked: Map<string, boolean>): ListView {
  return {
    ...list,
    sections: list.sections.map((section) => ({
      ...section,
      items: section.items.map((item) => ({ ...item, done: ticked.get(item.name) ?? item.done })),
    })),
  };
}

/** Sections with their open items; a section with none left is dropped. */
export function openSections(list: ListView): Section[] {
  return list.sections
    .map((section) => ({ ...section, items: section.items.filter((item) => !item.done) }))
    .filter((section) => section.items.length > 0);
}

/** Every ticked item, in note order. */
export function doneItems(list: ListView): ListItemView[] {
  return list.sections.flatMap((section) => section.items.filter((item) => item.done));
}

/** "7 left", "All done". */
export function leftLabel(count: number): string {
  return count === 0 ? "All done" : `${count} left`;
}
