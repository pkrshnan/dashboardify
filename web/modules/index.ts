// Every page of the web app, in sidebar order. Adding a page means adding its module here.

import { matchPath } from "../lib/router";
import { activity } from "./activity";
import { habits } from "./habits";
import { health } from "./health";
import { lists } from "./lists";
import { moreModule } from "./more";
import { settings } from "./settings";
import { today } from "./today";
import type { Module } from "./types";

export const MODULES: Module[] = [today, lists, habits, health, activity, settings];

/** More lists what the phone's tab bar has no room for; it is routed but not in the nav. */
export const MORE = moreModule(() => MODULES);

const ROUTED = [...MODULES, MORE];

/** The page an address shows, with its parameters; an unknown path shows Today. */
export function pageFor(
  path: string,
  modules: Module[] = ROUTED,
): { module: Module; params: Record<string, string> } {
  for (const module of modules) {
    const params = matchPath(module.path, path);
    if (params) {
      return { module, params };
    }
  }
  return { module: today, params: {} };
}
