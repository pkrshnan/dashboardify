// The Settings page, at `#/settings/<section>`. Desktop: a section list beside the section.
// Phone: the list, which pushes to each section; the tab bar is the way out.

import type { Token } from "../api";
import { href } from "../lib/router";
import { Calendars } from "./calendars";
import { Devices } from "./devices";
import { General } from "./general";
import { SECTIONS } from "./sections";

/** What every section gets: the token, and what to do when the server says it's no good. */
export interface SectionProps {
  token: Token;
  onUnauthorized: (setup: boolean) => void;
}

const VIEWS: Record<string, (props: SectionProps) => preact.JSX.Element> = {
  general: General,
  devices: Devices,
  calendars: Calendars,
};

interface Props extends SectionProps {
  section?: string;
  isPhone: boolean;
}

export function Settings({ section, isPhone, ...props }: Props) {
  if (isPhone) {
    return <PhoneSettings {...props} section={section} />;
  }
  const shown = section ?? SECTIONS[0]?.id;
  const View = shown ? VIEWS[shown] : undefined;
  return (
    <main class="settings">
      <div class="settings-grid">
        <nav aria-label="Settings sections">
          <h1>Settings</h1>
          <SectionList current={shown} />
        </nav>
        {View && <View {...props} />}
      </div>
    </main>
  );
}

/** The phone shows the list first; a section replaces it, with a way back. */
function PhoneSettings({ section, ...props }: SectionProps & { section?: string }) {
  const View = section ? VIEWS[section] : undefined;
  if (!View) {
    return (
      <main class="settings phone">
        <h1>Settings</h1>
        <SectionList current={undefined} />
      </main>
    );
  }
  return (
    <main class="settings phone">
      <a class="settings-back" href={href("/settings")}>
        ‹ Settings
      </a>
      <View {...props} />
    </main>
  );
}

function SectionList({ current }: { current: string | undefined }) {
  return (
    <div class="settings-sections">
      {SECTIONS.map((s) => (
        <a
          key={s.id}
          href={href(`/settings/${s.id}`)}
          aria-current={s.id === current ? "page" : undefined}
        >
          {s.title}
        </a>
      ))}
    </div>
  );
}
