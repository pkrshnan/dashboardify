// Every page of the web app, in sidebar order. Adding a page means adding its module here.

import { matchPath } from "../lib/router";
import { activity } from "./activity";
import { settings } from "./settings";
import { today } from "./today";
import type { Module } from "./types";

export const MODULES: Module[] = [today, activity, settings];

/** The page an address shows, with its parameters; an unknown path shows Today. */
export function pageFor(
  path: string,
  modules: Module[] = MODULES,
): { module: Module; params: Record<string, string> } {
  for (const module of modules) {
    const params = matchPath(module.path, path);
    if (params) {
      return { module, params };
    }
  }
  return { module: today, params: {} };
}
