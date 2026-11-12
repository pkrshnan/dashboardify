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

/** The address's section ("general"), or undefined for the list (phone) or an unknown one. */
export function knownSection(id: string | undefined): string | undefined {
  return SECTIONS.some((s) => s.id === id) ? id : undefined;
}

/** Every IANA zone the browser knows, for the time zone search. */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? [];
}
