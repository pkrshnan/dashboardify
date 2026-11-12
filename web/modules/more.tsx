// More, at `#/more`: on the phone, the pages that don't fit in the tab bar. It has no nav entry
// of its own; the tab bar shows a More tab only while there is something under it. The module
// list is passed in, since index.ts lists this module too.

import { Icon } from "../components/icons";
import { href } from "../lib/router";
import { pagePath, phoneTabs } from "./nav";
import type { Module } from "./types";

export function moreModule(all: () => Module[]): Module {
  return {
    id: "more",
    title: "More",
    icon: "more",
    path: "/more",
    key: "m",
    needsHome: false,
    view: () => <MorePage modules={phoneTabs(all()).more} />,
  };
}

function MorePage({ modules }: { modules: Module[] }) {
  return (
    <main class="more">
      <h1>More</h1>
      <nav aria-label="More pages">
        {modules.map((m) => (
          <a key={m.id} href={href(pagePath(m))}>
            <Icon name={m.icon} size={22} />
            <span>{m.title}</span>
          </a>
        ))}
      </nav>
    </main>
  );
}
