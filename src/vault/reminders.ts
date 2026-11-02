// One-way mirror of Apple Reminders, matched by reminder ID.
//
// The phone can send either the full set of open reminders (catches deletions) or only the
// reminders modified since the last sync (cheap, hourly). Either way the file is rendered
// deterministically, so an unchanged set produces identical bytes and no write or git commit.

import { renderNote } from "./markdown";

export interface Reminder {
  id: string;
  title: string;
  list: string;
  /** YYYY-MM-DD in the vault's time zone. */
  dueDate?: string;
  /** HH:MM in the vault's time zone, only when the reminder has a time. */
  dueTime?: string;
}

export interface ReminderDiff {
  added: string[];
  updated: string[];
  removed: string[];
}

const DEFAULT_LIST = "Reminders";
const LINE = /^- \[ \] (.*?)(?: 📅 (\d{4}-\d{2}-\d{2})(?: ⏰ (\d{2}:\d{2}))?)? <!-- id:(.+?) -->$/u;
const HEADING = /^## (.+)$/;

/** Read the mirror file back into reminders keyed by ID. Lines it didn't write are ignored. */
export function parseReminders(text: string | null): Map<string, Reminder> {
  const out = new Map<string, Reminder>();
  if (!text) return out;
  let list = DEFAULT_LIST;
  for (const line of text.split("\n")) {
    const heading = HEADING.exec(line);
    if (heading?.[1]) {
      list = heading[1];
      continue;
    }
    const m = LINE.exec(line);
    if (!m?.[1] || !m[4]) continue;
    out.set(m[4], { id: m[4], title: m[1], list, dueDate: m[2], dueTime: m[3] });
  }
  return out;
}

export function renderReminders(items: Iterable<Reminder>): string {
  const byList = new Map<string, Reminder[]>();
  for (const r of items) byList.set(r.list, [...(byList.get(r.list) ?? []), r]);
  const sections = [...byList.keys()].sort().map((list) => {
    const lines = (byList.get(list) ?? [])
      .sort(
        (a, b) =>
          (a.dueDate ?? "9999").localeCompare(b.dueDate ?? "9999") ||
          (a.dueTime ?? "99").localeCompare(b.dueTime ?? "99") ||
          a.title.localeCompare(b.title) ||
          a.id.localeCompare(b.id),
      )
      .map((r) => {
        const due = r.dueDate ? ` 📅 ${r.dueDate}${r.dueTime ? ` ⏰ ${r.dueTime}` : ""}` : "";
        return `- [ ] ${r.title}${due} <!-- id:${r.id} -->`;
      });
    return `## ${list}\n\n${lines.join("\n")}`;
  });
  return renderNote({
    frontmatter: { source: "apple-reminders" },
    body:
      "# Reminders\n\n> Mirrored from Apple Reminders. Make changes there; edits here are overwritten.\n\n" +
      (sections.length ? `${sections.join("\n\n")}\n` : "_No open reminders._\n"),
  });
}

function same(a: Reminder, b: Reminder): boolean {
  return a.title === b.title && a.list === b.list && a.dueDate === b.dueDate && a.dueTime === b.dueTime;
}

/**
 * Apply a sync to the current set.
 * - `full`: `upserts` is every open reminder; anything not in it is removed.
 * - `changes`: `upserts` are added or updated, `removedIds` (completed or deleted) are dropped,
 *   everything else is kept as it was.
 */
export function applySync(
  current: Map<string, Reminder>,
  mode: "full" | "changes",
  upserts: Reminder[],
  removedIds: string[] = [],
): { next: Map<string, Reminder>; diff: ReminderDiff } {
  const next = mode === "full" ? new Map<string, Reminder>() : new Map(current);
  const diff: ReminderDiff = { added: [], updated: [], removed: [] };
  for (const r of upserts) {
    const before = current.get(r.id);
    if (!before) diff.added.push(r.id);
    else if (!same(before, r)) diff.updated.push(r.id);
    next.set(r.id, r);
  }
  for (const id of removedIds) next.delete(id);
  for (const id of current.keys()) if (!next.has(id)) diff.removed.push(id);
  return { next, diff };
}
