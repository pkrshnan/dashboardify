// The sidebar on desktop and the floating tab bar on the phone, drawn from the module list
// (web/modules/nav.ts has the rules). Under 1200 px the sidebar is an icon rail; each name stays
// as the link's accessible name and tooltip.

import { href } from "../lib/router";
import { pagePath, phoneTabs, sidebarGroups } from "../modules/nav";
import type { Module } from "../modules/types";
import { Icon } from "./icons";

interface Props {
  modules: Module[];
  /** The id of the page showing now. */
  current: string;
}

export function Sidebar({ modules, current }: Props) {
  const { groups, bottom } = sidebarGroups(modules);
  return (
    <nav class="sidebar" aria-label="Pages">
      {groups.map((group) => (
        <div key={group[0]?.id} class="sidebar-group">
          {group.map((m) => (
            <NavLink key={m.id} module={m} current={m.id === current} />
          ))}
        </div>
      ))}
      <div class="sidebar-group sidebar-bottom">
        {bottom.map((m) => (
          <NavLink key={m.id} module={m} current={m.id === current} />
        ))}
      </div>
    </nav>
  );
}

function NavLink({ module, current }: { module: Module; current: boolean }) {
  return (
    <a
      href={href(pagePath(module))}
      aria-current={current ? "page" : undefined}
      title={`${module.title} (g ${module.key})`}
    >
      <Icon name={module.icon} />
      <span class="sidebar-name">{module.title}</span>
    </a>
  );
}

/** The phone's tabs, with More last while some pages don't fit. */
export function TabBar({ modules, current, more }: Props & { more: Module }) {
  const { tabs, more: under } = phoneTabs(modules);
  const shown = under.length > 0 ? [...tabs, more] : tabs;
  const inMore = under.some((m) => m.id === current);
  return (
    <nav class="tab-bar" aria-label="Pages">
      {shown.map((m) => (
        <a
          key={m.id}
          href={href(pagePath(m))}
          aria-current={m.id === current || (m === more && inMore) ? "page" : undefined}
        >
          <Icon name={m.icon} size={22} />
          <span>{m.title}</span>
        </a>
      ))}
    </nav>
  );
}
