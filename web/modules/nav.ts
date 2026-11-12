// How the module list becomes the sidebar and the phone's tab bar (docs/navigation.md, Places).
// Pure, so the rules are tested without a DOM; web/components/nav.tsx draws them.

import type { Module } from "./types";

/** The phone's tab bar holds this many pages; past it, the rest go under More. */
export const MAX_TABS = 4;

/** The address a nav entry opens: its path without parameters ("/settings/:section?" → "/settings"). */
export function pagePath(module: Module): string {
  const fixed = module.path.split("/").filter((part) => part !== "" && !part.startsWith(":"));
  return `/${fixed.join("/")}`;
}

/** The sidebar: groups 1–4 in order, empty ones dropped, and the bottom group apart. */
export function sidebarGroups(modules: Module[]): { groups: Module[][]; bottom: Module[] } {
  const groups = ([1, 2, 3, 4] as const)
    .map((group) => modules.filter((m) => m.nav?.group === group))
    .filter((group) => group.length > 0);
  return { groups, bottom: modules.filter((m) => m.nav?.group === "bottom") };
}

/**
 * The phone's tabs, and what goes under More. While every page fits, each one is a tab and there
 * is no More; after that, the pages marked "tab" stay and the rest move under More.
 */
export function phoneTabs(modules: Module[]): { tabs: Module[]; more: Module[] } {
  const listed = modules.filter((m) => m.nav);
  if (listed.length <= MAX_TABS) {
    return { tabs: listed, more: [] };
  }
  const tabs = listed.filter((m) => m.nav?.phone === "tab").slice(0, MAX_TABS - 1);
  return { tabs, more: listed.filter((m) => !tabs.includes(m)) };
}
