import { describe, expect, test } from "bun:test";
import { render } from "@testing-library/preact";
import { Sidebar, TabBar } from "../../web/components/nav";
import { MODULES, MORE } from "../../web/modules/index";
import { pagePath, phoneTabs, sidebarGroups } from "../../web/modules/nav";
import type { Module } from "../../web/modules/types";
import { useDom } from "./dom";

useDom();

/** A made-up page, for the rules that only start to matter with more pages than exist today. */
function page(id: string, group: 1 | 2 | 3 | 4 | "bottom", phone: "tab" | "more"): Module {
  return {
    id,
    title: id,
    icon: "today",
    path: `/${id}`,
    key: id[0] ?? "x",
    nav: { group, phone },
    needsHome: false,
    view: () => <p>{id}</p>,
  };
}

const SIX = [
  page("today", 1, "tab"),
  page("tasks", 2, "tab"),
  page("lists", 2, "tab"),
  page("health", 3, "tab"),
  page("activity", 3, "more"),
  page("settings", "bottom", "more"),
];

describe("nav rules", () => {
  test("a nav entry opens its page without parameters", () => {
    const settings = MODULES.find((m) => m.id === "settings");

    expect(settings && pagePath(settings)).toBe("/settings");
    expect(pagePath(MORE)).toBe("/more");
  });

  test("the sidebar keeps group order, drops empty groups and sets the bottom apart", () => {
    const { groups, bottom } = sidebarGroups(SIX);

    expect(groups.map((g) => g.map((m) => m.id))).toEqual([
      ["today"],
      ["tasks", "lists"],
      ["health", "activity"],
    ]);
    expect(bottom.map((m) => m.id)).toEqual(["settings"]);
  });

  test("while every page fits, each is a tab and there is no More", () => {
    const { tabs, more } = phoneTabs(SIX.slice(0, 5));

    expect(tabs.map((m) => m.id)).toEqual(["today", "tasks", "lists", "health", "activity"]);
    expect(more).toEqual([]);
  });

  test("Activity and Lifting go under More, with Settings", () => {
    const { tabs, more } = phoneTabs(MODULES);

    expect(tabs.map((m) => m.id)).toEqual(["today", "lists", "habits", "health"]);
    expect(more.map((m) => m.id)).toEqual(["activity", "lifting", "settings"]);
  });

  test("past five pages, the tab pages stay and the rest go under More", () => {
    const { tabs, more } = phoneTabs(SIX);

    expect(tabs.map((m) => m.id)).toEqual(["today", "tasks", "lists", "health"]);
    expect(more.map((m) => m.id)).toEqual(["activity", "settings"]);
  });
});

describe("Sidebar", () => {
  test("links every page and marks the one showing", () => {
    const { getAllByRole } = render(<Sidebar modules={MODULES} current="health" />);
    const links = getAllByRole("link");

    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/",
      "#/lists",
      "#/habits",
      "#/health",
      "#/activity",
      "#/lifting",
      "#/settings",
    ]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([
      null,
      null,
      null,
      "page",
      null,
      null,
      null,
    ]);
    expect(links[3]?.getAttribute("title")).toBe("Health (g h)");
  });
});

describe("TabBar", () => {
  test("shows Today, Lists, Habits and Health as tabs, and More for the rest", () => {
    const { getAllByRole } = render(<TabBar modules={MODULES} current="today" more={MORE} />);

    expect(getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Today",
      "Lists",
      "Habits",
      "Health",
      "More",
    ]);
  });

  test("adds More when pages don't fit, and marks it for a page under it", () => {
    const { getAllByRole } = render(<TabBar modules={SIX} current="activity" more={MORE} />);
    const links = getAllByRole("link");

    expect(links.map((a) => a.textContent)).toEqual(["today", "tasks", "lists", "health", "More"]);
    expect(links[4]?.getAttribute("aria-current")).toBe("page");
  });
});
