// What a page of the web app declares about itself. The shell (app.tsx) reads the list in
// index.ts to route, and later the sidebar, tab bar, command bar and shortcuts read it too, so a
// new page is one module file and nothing in the shell names it. docs/navigation.md has the plan.

import type { JSX } from "preact";
import type { HomeView } from "../../src/home/types";
import type { IconName } from "../components/icons";
import type { Now } from "../lib/clock";
import type { Address } from "../lib/router";

/** The home view, once loaded: most pages need its time zone and date, Today all of it. */
export interface LoadedHome {
  view: HomeView;
  now: Now;
  load: () => Promise<void>;
}

export interface PageProps {
  route: Address;
  /** The path's parameters, such as `section` for "/settings/:section?". */
  params: Record<string, string>;
  /** Set for a module with `needsHome`; null for the others while it loads. */
  home: LoadedHome | null;
}

export interface Module {
  /** Stable: used in addresses and, later, recency and command ids. */
  id: string;
  title: string;
  icon: IconName;
  /** "/", "/activity", "/settings/:section?" (see matchPath). */
  path: string;
  /** `g` then this letter goes to the page. */
  key: string;
  /**
   * Sidebar group (separated by space, not labelled) and where it sits on the phone. Without it
   * the page has an address but no nav entry, like More.
   */
  nav?: { group: 1 | 2 | 3 | 4 | "bottom"; phone: "tab" | "more" };
  /** The page waits for the home view before it shows. */
  needsHome: boolean;
  view: (props: PageProps) => JSX.Element | null;
}
