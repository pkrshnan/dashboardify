// Pure helpers for reading and rewriting Markdown notes.
// Nothing here touches the filesystem, so it is easy to test.

import { parse, stringify } from "yaml";

export type Frontmatter = Record<string, unknown>;

export interface Note {
  frontmatter: Frontmatter;
  body: string;
}

const FENCE = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/;

export function parseNote(text: string): Note {
  const match = FENCE.exec(text);
  if (!match) {
    return { frontmatter: {}, body: text };
  }
  const data = parse(match[1] ?? "") ?? {};
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return { frontmatter: data as Frontmatter, body: text.slice(match[0].length) };
}

export function renderNote(note: Note): string {
  const keys = Object.keys(note.frontmatter);
  if (keys.length === 0) {
    return note.body;
  }
  const yaml = stringify(note.frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${note.body}`;
}

/** Shallow-merge fields into frontmatter. `undefined` values are ignored. */
export function mergeFrontmatter(note: Note, fields: Frontmatter): Note {
  const next = { ...note.frontmatter };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) {
      next[key] = value;
    }
  }
  return { ...note, frontmatter: next };
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
