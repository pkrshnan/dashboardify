// The rules behind Settings › Calendars, apart from the page so they can be tested.

import type { CalendarAccountView, CalendarCategory, CalendarView } from "../api";

export const CATEGORIES: { value: CalendarCategory; label: string }[] = [
  { value: "personal", label: "Personal" },
  { value: "work", label: "Work" },
  { value: "fitness", label: "Fitness" },
  { value: "relationships", label: "Relationships" },
  { value: "family", label: "Family" },
  { value: "focus", label: "Focus" },
];

/** "Synced 09:10", "Sign-in failed. …", or "Can't reach iCloud. …". */
export function statusLine(account: CalendarAccountView): { text: string; warn: boolean } {
  if (account.status === "STATUS_AUTH_FAILED") {
    return {
      text: "Sign-in failed. The app-specific password was revoked or changed.",
      warn: true,
    };
  }
  if (account.status === "STATUS_UNREACHABLE") {
    return { text: `Can't reach iCloud. ${account.statusDetail ?? ""}`.trim(), warn: true };
  }
  if (!account.lastSyncTime) {
    return { text: "Not synced yet", warn: false };
  }
  const time = new Date(account.lastSyncTime).toLocaleTimeString("en-GB", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return { text: `Synced ${time}`, warn: false };
}

/** "Read-only" for calendars new events can't go on; "Kept read-only here" when locked here. */
export function calendarNote(calendar: CalendarView): string {
  if (calendar.forceReadOnly) {
    return "Kept read-only here";
  }
  return calendar.writable ? "" : "Read-only";
}

/** The calendars the default and rules may point at: writable and shown. */
export function writableChoices(calendars: CalendarView[]): CalendarView[] {
  return calendars.filter((c) => c.writable && c.enabled);
}

/** "gym, run , swim" → ["gym", "run", "swim"] */
export function parseWords(text: string): string[] {
  return text
    .split(",")
    .map((word) => word.trim())
    .filter(Boolean);
}

/**
 * After connecting: the calendars whose category or Show switch you changed on the "found"
 * screen, matched to the saved ones by position (the server keeps its order).
 */
export function changesAfterConnect(
  chosen: CalendarView[],
  saved: CalendarView[],
): { name: string; change: Partial<Pick<CalendarView, "category" | "enabled">> }[] {
  return chosen.flatMap((pick, i) => {
    const calendar = saved[i];
    if (!calendar || calendar.displayName !== pick.displayName) {
      return [];
    }
    const change: Partial<Pick<CalendarView, "category" | "enabled">> = {};
    if (pick.category !== calendar.category) {
      change.category = pick.category;
    }
    if (pick.enabled !== calendar.enabled) {
      change.enabled = pick.enabled;
    }
    return Object.keys(change).length > 0 ? [{ name: calendar.name, change }] : [];
  });
}
