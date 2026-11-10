// Settings, at `#/settings/<section>` (web/settings/). It doesn't wait for the home view.

import { knownSection } from "../settings/sections";
import { Settings } from "../settings/settings";
import { useApp } from "./context";
import type { Module, PageProps } from "./types";

export const settings: Module = {
  id: "settings",
  title: "Settings",
  path: "/settings/:section?",
  key: "s",
  nav: { group: "bottom", phone: "more" },
  needsHome: false,
  view: SettingsPage,
};

function SettingsPage({ params }: PageProps) {
  const { token, onUnauthorized, isPhone } = useApp();
  return (
    <Settings
      token={token}
      onUnauthorized={onUnauthorized}
      section={knownSection(params.section)}
      isPhone={isPhone}
    />
  );
}
