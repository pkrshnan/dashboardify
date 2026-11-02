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
  if (!match) return { frontmatter: {}, body: text };
  const data = parse(match[1] ?? "") ?? {};
  if (typeof data !== "object" || Array.isArray(data)) {
    throw new Error("frontmatter must be a YAML mapping");
  }
  return { frontmatter: data as Frontmatter, body: text.slice(match[0].length) };
}

export function renderNote(note: Note): string {
  const keys = Object.keys(note.frontmatter);
  if (keys.length === 0) return note.body;
  const yaml = stringify(note.frontmatter, { lineWidth: 0 }).trimEnd();
  return `---\n${yaml}\n---\n${note.body}`;
}

/** Shallow-merge fields into frontmatter. `undefined` values are ignored. */
export function mergeFrontmatter(note: Note, fields: Frontmatter): Note {
  const next = { ...note.frontmatter };
  for (const [key, value] of Object.entries(fields)) {
    if (value !== undefined) next[key] = value;
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
  const sep = body.length === 0 || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
  return `${body}${sep}${block}\n`;
}

/**
 * Append a line at the end of the `## heading` section, before the next
 * heading of the same or higher level. Creates the section if missing.
 */
export function appendToSection(body: string, heading: string, line: string): string {
  const lines = body.split("\n");
  const target = `## ${heading}`;
  const idx = lines.findIndex((l) => l.trim() === target);
  if (idx === -1) {
    const trimmed = body.replace(/\n*$/, "");
    const prefix = trimmed.length ? `${trimmed}\n\n` : "";
    return `${prefix}${target}\n\n${line}\n`;
  }
  let end = lines.length;
  for (let i = idx + 1; i < lines.length; i++) {
    if (/^#{1,2} /.test(lines[i] ?? "")) {
      end = i;
      break;
    }
  }
  // Insert after the last non-blank line of the section.
  let insertAt = end;
  while (insertAt > idx + 1 && (lines[insertAt - 1] ?? "").trim() === "") insertAt--;
  const needsGap = insertAt === idx + 1;
  const insert = needsGap ? ["", line] : [line];
  lines.splice(insertAt, 0, ...insert);
  // Keep one blank line before the next heading.
  const after = insertAt + insert.length;
  if (after < lines.length && (lines[after] ?? "").trim() !== "") lines.splice(after, 0, "");
  return lines.join("\n");
}
