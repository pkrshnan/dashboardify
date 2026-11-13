// An item's details as `- key: value` sub-bullets under its line (docs/fields.md). Tasks and
// habits share this. Pure: works on a note's lines, and touches only the keys it's given, so
// notes and nested items under the line stay as they are.

export type Fields = Record<string, string>;

const FIELD = /^\s+[-*] ([A-Za-z]+):[ \t]*(.*)$/;
const TAB_WIDTH = 4;

/** The indexes of the lines under `item` that are its fields with one of `keys`, in order. */
export function fieldLines(lines: string[], item: number, keys: readonly string[]): number[] {
  const own: number[] = [];
  for (const index of childLines(lines, item)) {
    const key = FIELD.exec(lines[index] ?? "")?.[1]?.toLowerCase();
    if (key && keys.includes(key)) {
      own.push(index);
    }
  }
  return own;
}

/** The item's fields with one of `keys`, by lower-case key. The first of a repeated key wins. */
export function readFields(lines: string[], item: number, keys: readonly string[]): Fields {
  const fields: Fields = {};
  for (const index of fieldLines(lines, item, keys)) {
    const match = FIELD.exec(lines[index] ?? "");
    const key = match?.[1]?.toLowerCase() ?? "";
    const value = match?.[2]?.trim() ?? "";
    if (!(key in fields) && value !== "") {
      fields[key] = value;
    }
  }
  return fields;
}

/**
 * Lines for `fields` in `keys` order, one tab deeper than `indent`. Keys without a value are
 * left out.
 */
export function formatFields(
  fields: Partial<Fields>,
  keys: readonly string[],
  indent: string,
): string[] {
  return keys.flatMap((key) => (fields[key] ? [`${indent}\t- ${key}: ${fields[key]}`] : []));
}

/**
 * Replaces the item at `item` and its fields with one of `keys` by `replacement` (the item's
 * new line and fields, or nothing to delete it). Other lines under it are kept. Edits `lines`.
 */
export function replaceItem(
  lines: string[],
  item: number,
  keys: readonly string[],
  replacement: string[],
): void {
  for (const index of fieldLines(lines, item, keys).reverse()) {
    lines.splice(index, 1);
  }
  lines.splice(item, 1, ...replacement);
}

/**
 * The lines that belong directly to `item`: below it, up to a blank line or one indented no
 * deeper, and not under a deeper line in between (those are a nested item's).
 */
function childLines(lines: string[], item: number): number[] {
  const base = width(lines[item] ?? "");
  const children: number[] = [];
  let childWidth: number | null = null;
  for (let index = item + 1; index < lines.length; index++) {
    const line = lines[index] ?? "";
    const indent = width(line);
    if (line.trim() === "" || indent <= base) {
      break;
    }
    // The first child sets the level; anything deeper belongs to a child.
    childWidth ??= indent;
    if (indent <= childWidth) {
      childWidth = indent;
      children.push(index);
    }
  }
  return children;
}

/** The width of a line's leading whitespace, a tab counted as Obsidian shows it. */
function width(line: string): number {
  let total = 0;
  for (const char of /^\s*/.exec(line)?.[0] ?? "") {
    total += char === "\t" ? TAB_WIDTH : 1;
  }
  return total;
}
