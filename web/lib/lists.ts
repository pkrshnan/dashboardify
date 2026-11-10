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

/** The list's headings, in note order, for picking where to add or move an item. */
export function sectionTitles(list: ListView): string[] {
  return list.sections.map((section) => section.title).filter((title) => title !== "");
}

/**
 * While an item is dragged, every section is a place to drop it, even one with nothing left
 * and the unheaded block at the top.
 */
export function dropSections(list: ListView): Section[] {
  const open = list.sections.map((section) => ({
    ...section,
    items: section.items.filter((item) => !item.done),
  }));
  return open[0]?.title === "" ? open : [{ title: "", items: [] }, ...open];
}

/** The section a drop at height `y` lands in: the one it's over, else the nearest. */
export function sectionAt(boxes: { title: string; top: number; bottom: number }[], y: number) {
  let best: { title: string; distance: number } | null = null;
  for (const box of boxes) {
    const distance = Math.max(box.top - y, y - box.bottom, 0);
    if (!best || distance < best.distance) {
      best = { title: box.title, distance };
    }
  }
  return best?.title ?? null;
}

/** Pixels a frame to scroll while dragging within 60 of the window's top or bottom edge. */
export function edgeScroll(y: number, height: number): number {
  if (y < 60) {
    return -12;
  }
  return y > height - 60 ? 12 : 0;
}

/** The section above (`step` -1) or below (+1), for moving with the arrow keys. */
export function stepSection(titles: string[], from: string, step: -1 | 1): string | null {
  const all = ["", ...titles];
  return all[all.indexOf(from) + step] ?? null;
}

/** The list with a move shown before the server confirms it: the item goes to the section's end. */
export function withMove(list: ListView, name: string, to: string): ListView {
  const item = list.sections.flatMap((section) => section.items).find((i) => i.name === name);
  if (!item) {
    return list;
  }
  const moved = { ...item, section: to };
  const sections = list.sections.map((section) => ({
    ...section,
    items: section.items.filter((i) => i.name !== name),
  }));
  const target = sections.find((section) => section.title === to);
  if (target) {
    target.items.push(moved);
  } else if (to === "") {
    sections.unshift({ title: "", items: [moved] });
  } else {
    sections.push({ title: to, items: [moved] });
  }
  return { ...list, sections };
}
