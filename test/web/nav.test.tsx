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

const FIVE = [
  page("today", 1, "tab"),
  page("tasks", 2, "tab"),
  page("lists", 2, "tab"),
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
    const { groups, bottom } = sidebarGroups(FIVE);

    expect(groups.map((g) => g.map((m) => m.id))).toEqual([
      ["today"],
      ["tasks", "lists"],
      ["activity"],
    ]);
    expect(bottom.map((m) => m.id)).toEqual(["settings"]);
  });

  test("while every page fits, each is a tab and there is no More", () => {
    const { tabs, more } = phoneTabs(MODULES);

    expect(tabs.map((m) => m.id)).toEqual(["today", "lists", "activity", "settings"]);
    expect(more).toEqual([]);
  });

  test("past four pages, the tab pages stay and the rest go under More", () => {
    const { tabs, more } = phoneTabs(FIVE);

    expect(tabs.map((m) => m.id)).toEqual(["today", "tasks", "lists"]);
    expect(more.map((m) => m.id)).toEqual(["activity", "settings"]);
  });
});

describe("Sidebar", () => {
  test("links every page and marks the one showing", () => {
    const { getAllByRole } = render(<Sidebar modules={MODULES} current="activity" />);
    const links = getAllByRole("link");

    expect(links.map((a) => a.getAttribute("href"))).toEqual([
      "#/",
      "#/lists",
      "#/activity",
      "#/settings",
    ]);
    expect(links.map((a) => a.getAttribute("aria-current"))).toEqual([null, null, "page", null]);
    expect(links[2]?.getAttribute("title")).toBe("Activity (g a)");
  });
});

describe("TabBar", () => {
  test("shows today's pages as tabs, with no More", () => {
    const { getAllByRole } = render(<TabBar modules={MODULES} current="today" more={MORE} />);

    expect(getAllByRole("link").map((a) => a.textContent)).toEqual([
      "Today",
      "Lists",
      "Activity",
      "Settings",
    ]);
  });

  test("adds More when pages don't fit, and marks it for a page under it", () => {
    const { getAllByRole } = render(<TabBar modules={FIVE} current="activity" more={MORE} />);
    const links = getAllByRole("link");

    expect(links.map((a) => a.textContent)).toEqual(["today", "tasks", "lists", "More"]);
    expect(links[3]?.getAttribute("aria-current")).toBe("page");
  });
});
