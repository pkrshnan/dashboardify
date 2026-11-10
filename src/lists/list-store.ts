// The list notes in the vault's Lists/ folder: finding them, reading one, creating one, and
// editing one with the note's etag so a change made in Obsidian meanwhile isn't overwritten.
// docs/lists.md has the format.

import { createHash } from "node:crypto";
import type { Vault } from "../vault/vault";
import { type ListItem, parseList } from "./list-note";

export const LISTS_FOLDER = "Lists";

export interface ListSummary {
  /** The file name's slug: Lists/Gift ideas.md → "gift-ideas". */
  slug: string;
  title: string;
  path: string;
  openCount: number;
}

export interface ListSection {
  title: string | null;
  items: ListItem[];
}

export interface ListDoc extends ListSummary {
  sections: ListSection[];
  /** A hash of the note; an edit that sends an old one is refused. */
  etag: string;
}

export class ListNotFound extends Error {}
export class StaleList extends Error {}
export class InvalidTitle extends Error {}

export class ListStore {
  constructor(private readonly vault: Vault) {}

  /** Every list, by title. */
  async lists(): Promise<ListSummary[]> {
    const found: ListSummary[] = [];
    for (const path of await this.paths()) {
      const text = (await this.vault.read(path)) ?? "";
      found.push(summary(path, text));
    }
    return found.sort((a, b) => a.title.localeCompare(b.title));
  }

  async get(slug: string): Promise<ListDoc | null> {
    const path = await this.pathOf(slug);
    if (!path) {
      return null;
    }
    return doc(path, (await this.vault.read(path)) ?? "");
  }

  /** Makes Lists/<title>.md, or returns the list already there with that slug. */
  async create(title: string): Promise<{ list: ListDoc; created: boolean }> {
    const name = checkTitle(title);
    const existing = await this.get(slugOf(name));
    if (existing) {
      return { list: existing, created: false };
    }
    const path = `${LISTS_FOLDER}/${name}.md`;
    await this.vault.update(path, (current) => current ?? `# ${name}\n`);
    return { list: doc(path, (await this.vault.read(path)) ?? ""), created: true };
  }

  /**
   * Runs `edit` on the note's text. `etag`, when given, must match the note as it is now.
   * `edit` returns the new text, or null to change nothing.
   */
  async edit(
    slug: string,
    etag: string | undefined,
    edit: (text: string) => string | null,
  ): Promise<ListDoc> {
    const path = await this.pathOf(slug);
    if (!path) {
      throw new ListNotFound(`No list ${slug}.`);
    }
    let stale = false;
    await this.vault.update(path, (current) => {
      const text = current ?? "";
      if (etag && etag !== etagOf(text)) {
        stale = true;
        return null;
      }
      return edit(text);
    });
    if (stale) {
      throw new StaleList("The list changed since you loaded it. Reload and try again.");
    }
    return doc(path, (await this.vault.read(path)) ?? "");
  }

  private async paths(): Promise<string[]> {
    const paths: string[] = [];
    const glob = new Bun.Glob(`${LISTS_FOLDER}/*.md`);
    for await (const path of glob.scan({ cwd: this.vault.root })) {
      paths.push(path);
    }
    return paths;
  }

  private async pathOf(slug: string): Promise<string | undefined> {
    return (await this.paths()).find((path) => slugOf(titleOf(path)) === slug);
  }
}

/** "Gift ideas" → "gift-ideas"; accents are dropped, so "Café" → "cafe". */
export function slugOf(title: string): string {
  const slug = title
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return slug || "list";
}

/** A title that can be a file name in Lists/: no slashes, no leading dot, at most 80 characters. */
function checkTitle(title: string): string {
  const name = title.trim();
  if (name === "" || name.length > 80 || /[/\\:]/.test(name) || name.startsWith(".")) {
    throw new InvalidTitle("A list's name can't be empty, start with a dot, or hold / \\ or :.");
  }
  return name;
}

function titleOf(path: string): string {
  return path.slice(LISTS_FOLDER.length + 1).replace(/\.md$/, "");
}

function etagOf(text: string): string {
  return createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function summary(path: string, text: string): ListSummary {
  const title = titleOf(path);
  const openCount = parseList(text).items.filter((item) => !item.done).length;
  return { slug: slugOf(title), title, path, openCount };
}

function doc(path: string, text: string): ListDoc {
  const list = parseList(text);
  // A heading used twice is one section, as it reads on the page.
  const sections = [...new Set(list.sections)].map((title) => ({
    title,
    items: list.items.filter((item) => item.section === title),
  }));
  return {
    ...summary(path, text),
    sections: sections.filter((s) => s.title !== null || s.items.length > 0),
    etag: etagOf(text),
  };
}
