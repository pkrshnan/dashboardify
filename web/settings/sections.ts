// The Settings page's sections, in order, and helpers the sections share.

export interface SettingsSection {
  id: string;
  title: string;
}

export const SECTIONS: SettingsSection[] = [
  { id: "general", title: "General" },
  { id: "devices", title: "Devices" },
  { id: "calendars", title: "Calendars" },
];

/** "#settings", "#settings/general" → the section to show, or undefined for the list (phone). */
export function sectionFromHash(hash: string): string | undefined {
  const [, id] = hash.replace(/^#/, "").split("/");
  return SECTIONS.some((s) => s.id === id) ? id : undefined;
}

/** Every IANA zone the browser knows, for the time zone search. */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? [];
}
