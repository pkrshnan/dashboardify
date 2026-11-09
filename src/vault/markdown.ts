// Pure helpers for reading and rewriting Markdown notes.
// Nothing here touches the filesystem, so it is easy to test.

import matter from "gray-matter";
import { parse, stringify } from "yaml";

export type Frontmatter = Record<string, unknown>;

export interface Note {
  frontmatter: Frontmatter;
  body: string;
}

// gray-matter finds and strips the `---` block; the `yaml` package does the YAML itself, because
// it keeps dates like `2026-11-02` as plain strings (gray-matter's default turns them into Dates).
const MATTER_OPTIONS = {
  engines: {
    yaml: {
      parse: (text: string): object => parse(text) ?? {},
      stringify: (data: object): string => stringify(data, { lineWidth: 0 }),
    },
  },
};

/** Split a note into its frontmatter and body. A note without frontmatter has `{}`. */
export function parseNote(text: string): Note {
  const { data, content } = matter(text, MATTER_OPTIONS);
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return { frontmatter: data, body: content };
}

/** Join frontmatter and body back into a note. Empty frontmatter is left out entirely. */
export function renderNote(note: Note): string {
  if (Object.keys(note.frontmatter).length === 0) {
    return note.body;
  }
  return matter.stringify({ content: note.body }, note.frontmatter, MATTER_OPTIONS);
}

/** Shallow-merge fields into frontmatter. `undefined` values are ignored. */
export function mergeFrontmatter(note: Note, fields: Frontmatter): Note {
  const defined = Object.entries(fields).filter(([, value]) => value !== undefined);
  return { ...note, frontmatter: { ...note.frontmatter, ...Object.fromEntries(defined) } };
}

/**
 * Parse a note, apply `edit`, and render it again: the one place notes are rewritten.
 * `text` is null for a note that doesn't exist yet, in which case `empty` is the starting point.
 */
export function editNote(text: string | null, empty: Note, edit: (note: Note) => Note): string {
  return renderNote(edit(text === null ? empty : parseNote(text)));
}

/**
 * Replace the machine-owned region `<!-- cc:name -->…<!-- /cc:name -->`.
 * If the region does not exist it is appended to the end of the body.
 * Text outside the markers is never touched.
 */
export function replaceBlock(body: string, name: string, content: string): string {
  const open = `<!-- cc:${name} -->`;
  const close = `<!-- /cc:${name} -->`;
  const block = `${open}\n${content.trimEnd()}\n${close}`;
  const start = body.indexOf(open);
  const end = body.indexOf(close);
  if (start !== -1 && end > start) {
    return body.slice(0, start) + block + body.slice(end + close.length);
  }
  return `${body}${blankLineBefore(body)}${block}\n`;
}

/**
 * Like replaceBlock, but a new region goes right under the note's `# title`, above the sections
 * people append to (a region at the end would sit inside the last section, e.g. `## Journal`).
 */
export function replaceBlockAtTop(body: string, name: string, content: string): string {
  if (body.includes(`<!-- cc:${name} -->`)) {
    return replaceBlock(body, name, content);
  }
  const block = `<!-- cc:${name} -->\n${content.trimEnd()}\n<!-- /cc:${name} -->\n`;
  const lines = body.split("\n");
  const title = lines.findIndex((line) => /^# /.test(line));
  if (title === -1) {
    return `${block}\n${body}`;
  }
  const head = lines.slice(0, title + 1).join("\n");
  const rest = lines
    .slice(title + 1)
    .join("\n")
    .replace(/^\n+/, "");
  return `${head}\n\n${block}${rest === "" ? "" : `\n${rest}`}`;
}

/** What to add to the end of `body` so the next thing starts after exactly one blank line. */
function blankLineBefore(body: string): string {
  if (body === "" || body.endsWith("\n\n")) {
    return "";
  }
  return body.endsWith("\n") ? "\n" : "\n\n";
}

/**
 * Append a line at the end of the `## heading` section, before the next heading of the same or
 * higher level. Creates the section at the end of the body if it's missing.
 */
export function appendToSection(body: string, heading: string, line: string): string {
  const lines = body.split("\n");
  const title = `## ${heading}`;
  const headingIndex = lines.findIndex((l) => l.trim() === title);
  if (headingIndex === -1) {
    const trimmed = body.replace(/\n*$/, "");
    const prefix = trimmed === "" ? "" : `${trimmed}\n\n`;
    return `${prefix}${title}\n\n${line}\n`;
  }

  const insertAt = lastContentLine(lines, headingIndex, sectionEnd(lines, headingIndex));
  const isEmptySection = insertAt === headingIndex + 1;
  const inserted = isEmptySection ? ["", line] : [line];
  lines.splice(insertAt, 0, ...inserted);

  // Keep one blank line before the next heading.
  const after = insertAt + inserted.length;
  if (after < lines.length && (lines[after] ?? "").trim() !== "") {
    lines.splice(after, 0, "");
  }
  return lines.join("\n");
}

/** The lines under `## heading`, up to the next heading of the same or higher level; null if missing. */
export function sectionLines(body: string, heading: string): string[] | null {
  const lines = body.split("\n");
  const headingIndex = lines.findIndex((l) => l.trim() === `## ${heading}`);
  return headingIndex === -1
    ? null
    : lines.slice(headingIndex + 1, sectionEnd(lines, headingIndex));
}

/** Index of the next `#` or `##` heading after `headingIndex`, or the end of the lines. */
function sectionEnd(lines: string[], headingIndex: number): number {
  const next = lines.findIndex((l, i) => i > headingIndex && /^#{1,2} /.test(l));
  return next === -1 ? lines.length : next;
}

/** Index just after the section's last non-blank line. */
function lastContentLine(lines: string[], headingIndex: number, end: number): number {
  let index = end;
  while (index > headingIndex + 1 && (lines[index - 1] ?? "").trim() === "") {
    index--;
  }
  return index;
}
