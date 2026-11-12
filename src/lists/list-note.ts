// Reading and editing one list note (docs/lists.md): `##` headings are sections, `- [ ]` and
// `- [x]` lines are items, and every other line is kept exactly as it is. Pure: list-store.ts
// reads and writes the files.

import { createHash } from "node:crypto";

export interface ListItem {
  /** Stable while the item's section and text stay the same (see itemId). */
  id: string;
  text: string;
  /** A trailing "(…)" on the line, shown beside the item: "2 bags". */
  note: string | null;
  done: boolean;
  /** The `##` heading it sits under, or null for the items before the first one. */
  section: string | null;
  line: number;
}

export interface ParsedList {
  lines: string[];
  items: ListItem[];
  /** Section names in note order, null first for the items before any heading. */
  sections: (string | null)[];
}

const ITEM = /^[-*] \[( |x|X)\] (.*)$/;
const SECTION = /^## (.+?)\s*$/;
const NOTE = /^(.*\S)\s+\(([^()]+)\)$/;

export function parseList(text: string): ParsedList {
  const lines = text.split("\n");
  const items: ListItem[] = [];
  const sections: (string | null)[] = [null];
  const seen = new Map<string, number>();
  let section: string | null = null;
  for (const [line, raw] of lines.entries()) {
    const heading = SECTION.exec(raw);
    if (heading) {
      section = heading[1] ?? "";
      sections.push(section);
      continue;
    }
    const match = ITEM.exec(raw);
    if (!match) {
      continue;
    }
    const { text, note } = splitNote(match[2] ?? "");
    const key = `${section ?? ""}\n${text.toLowerCase()}`;
    const occurrence = seen.get(key) ?? 0;
    seen.set(key, occurrence + 1);
    items.push({ id: itemId(key, occurrence), text, note, done: match[1] !== " ", section, line });
  }
  return { lines, items, sections };
}

/** "Spinach (2 bags)" → text "Spinach", note "2 bags". */
export function splitNote(entry: string): { text: string; note: string | null } {
  const trimmed = entry.trim();
  const match = NOTE.exec(trimmed);
  return match
    ? { text: match[1] ?? "", note: match[2]?.trim() ?? null }
    : { text: trimmed, note: null };
}

export function itemLine(item: Pick<ListItem, "text" | "note" | "done">): string {
  const note = item.note ? ` (${item.note})` : "";
  return `- [${item.done ? "x" : " "}] ${item.text}${note}`;
}

/**
 * Adds entries ("oat milk", "Spinach (2 bags)") to the list. One already on it and open is left
 * alone; one on it and ticked is unticked where it is, so it goes back to its section. Anything
 * else is a new line at the end of `section`, or of the block before the first heading when
 * there's none; a section that isn't there yet gets a heading at the end of the note. A ticked
 * match is moved to `section` when one is given. Returns the new text and each entry's item, in
 * the order given.
 */
export function addItems(
  text: string,
  entries: string[],
  section?: string,
): { text: string; items: ListItem[] } {
  let current = text;
  const keys: string[] = [];
  for (const entry of entries) {
    const { text: name, note } = splitNote(entry);
    if (name === "") {
      continue;
    }
    keys.push(name.toLowerCase());
    current = addOne(current, name, note, section?.trim() || null);
  }
  const { items } = parseList(current);
  const found = keys.map((key) => items.find((item) => item.text.toLowerCase() === key));
  return { text: current, items: found.filter((item) => item !== undefined) };
}

function addOne(text: string, name: string, note: string | null, section: string | null): string {
  const list = parseList(text);
  const same = list.items.filter((item) => item.text.toLowerCase() === name.toLowerCase());
  if (same.some((item) => !item.done)) {
    return text;
  }
  const ticked = same[0];
  if (ticked) {
    const unticked = replaceLine(
      list.lines,
      ticked.line,
      itemLine({ ...ticked, note: note ?? ticked.note, done: false }),
    );
    return section ? (moveItem(unticked, ticked.id, section)?.text ?? unticked) : unticked;
  }
  return insertBlock(list, section, [itemLine({ text: name, note, done: false })]).text;
}

/**
 * Moves one item, with its indented lines, to the end of `section` (null: the block before the
 * first heading), making the heading if it isn't there. Its id changes with its section; the
 * moved item is returned. Null when no item has that id.
 */
export function moveItem(
  text: string,
  id: string,
  section: string | null,
): { text: string; item: ListItem } | null {
  const list = parseList(text);
  const item = list.items.find((candidate) => candidate.id === id);
  if (!item) {
    return null;
  }
  const target = section?.trim() || null;
  if (sameSection(item.section, target)) {
    return { text, item };
  }
  const own = linesOf(list.lines, [item]);
  const block = list.lines.filter((_, line) => own.has(line));
  const rest = parseList(withoutLines(list.lines, own).join("\n"));
  const { text: moved, at } = insertBlock(rest, target, block);
  const found = parseList(moved).items.find((candidate) => candidate.line === at);
  return found ? { text: moved, item: found } : null;
}

/** Inserts `block` at the end of a section; `at` is the line its first line lands on. */
function insertBlock(
  list: ParsedList,
  section: string | null,
  block: string[],
): { text: string; at: number } {
  const lines = [...list.lines];
  const at =
    section === null
      ? insertAtTop(lines, block)
      : insertInSection(lines, list.items, section, block);
  return { text: lines.join("\n"), at };
}

function insertAtTop(lines: string[], block: string[]): number {
  const at = topInsertIndex(lines);
  // A blank line after a title, and before a section heading that would otherwise touch it.
  const lead = (lines[at - 1] ?? "").startsWith("# ") ? [""] : [];
  const tail = SECTION.test(lines[at] ?? "") ? [""] : [];
  lines.splice(at, 0, ...lead, ...block, ...tail);
  return at + lead.length;
}

/** After the section's last item, or under its heading; a new heading goes at the end. */
function insertInSection(
  lines: string[],
  items: ListItem[],
  section: string,
  block: string[],
): number {
  const last = items.filter((item) => sameSection(item.section, section)).at(-1);
  const heading = lines.findIndex((line) => sameSection(SECTION.exec(line)?.[1] ?? null, section));
  const at = last ? Math.max(...linesOf(lines, [last])) + 1 : heading + 1;
  if (last || heading !== -1) {
    lines.splice(at, 0, ...block);
    return at;
  }
  // After a blank line, keeping the note's final newline.
  const ending = lines.at(-1) === "" ? [""] : [];
  while (lines.length > 0 && (lines.at(-1) ?? "").trim() === "") {
    lines.pop();
  }
  const lead = lines.length > 0 ? [""] : [];
  lines.push(...lead, `## ${section}`, ...block, ...ending);
  return lines.length - block.length - ending.length;
}

/**
 * Where a new item goes: after the last line of the block before the first `##` heading, so
 * blank lines between that block and the heading stay where they were. Without a heading, the
 * end of the note.
 */
function topInsertIndex(lines: string[]): number {
  const heading = lines.findIndex((line) => SECTION.test(line));
  let at = heading === -1 ? lines.length : heading;
  while (at > 0 && (lines[at - 1] ?? "").trim() === "") {
    at -= 1;
  }
  return at;
}

/** Headings match ignoring case, so "produce" is Produce. */
function sameSection(a: string | null, b: string | null): boolean {
  return (a ?? "").toLowerCase() === (b ?? "").toLowerCase();
}

/**
 * Changes one item's text, note or tick, and moves it when `section` is given (null: before the
 * first heading). Null when no item has that id.
 */
export function updateItem(
  text: string,
  id: string,
  change: { text?: string; note?: string | null; done?: boolean; section?: string | null },
): { text: string; item: ListItem } | null {
  const list = parseList(text);
  const item = list.items.find((candidate) => candidate.id === id);
  if (!item) {
    return null;
  }
  const { section, ...line } = change;
  const next = { ...item, ...line, text: line.text?.trim() || item.text };
  const edited = replaceLine(list.lines, item.line, itemLine(next));
  const updated = parseList(edited).items.find((candidate) => candidate.line === item.line);
  if (!updated || section === undefined) {
    return updated ? { text: edited, item: updated } : null;
  }
  return moveItem(edited, updated.id, section);
}

/** Removes one item and its indented lines. Null when no item has that id. */
export function removeItem(text: string, id: string): string | null {
  const list = parseList(text);
  const item = list.items.find((candidate) => candidate.id === id);
  if (!item) {
    return null;
  }
  return withoutLines(list.lines, linesOf(list.lines, [item])).join("\n");
}

/** Removes every ticked item and its indented lines. */
export function clearDone(text: string): { text: string; removed: number } {
  const list = parseList(text);
  const done = list.items.filter((item) => item.done);
  const kept = withoutLines(list.lines, linesOf(list.lines, done));
  return { text: kept.join("\n"), removed: done.length };
}

/** Each item's line and the indented lines under it ("  - the unwaxed ones"). */
function linesOf(lines: string[], items: ListItem[]): Set<number> {
  const out = new Set<number>();
  for (const item of items) {
    out.add(item.line);
    for (let line = item.line + 1; /^\s+\S/.test(lines[line] ?? ""); line++) {
      out.add(line);
    }
  }
  return out;
}

function withoutLines(lines: string[], drop: Set<number>): string[] {
  return lines.filter((_, line) => !drop.has(line));
}

/**
 * An item's id: its section and lower-cased text, and which occurrence of that pair it is, so
 * editing other lines or adding items elsewhere doesn't change it. No marker goes into the note.
 */
function itemId(key: string, occurrence: number): string {
  return createHash("sha256").update(`${key}\n${occurrence}`).digest("hex").slice(0, 10);
}

function replaceLine(lines: string[], line: number, value: string): string {
  return lines.map((existing, i) => (i === line ? value : existing)).join("\n");
}
