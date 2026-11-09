// The Settings page's sections, in order, and the rules every section shares. Later plans add
// sections here (Devices, Calendars).

export interface SettingsSection {
  id: string;
  title: string;
}

export const SECTIONS: SettingsSection[] = [
  { id: "general", title: "General" },
  { id: "devices", title: "Devices" },
];

/** "#settings", "#settings/general" → the section to show, or undefined for the list (phone). */
export function sectionFromHash(hash: string): string | undefined {
  const [, id] = hash.replace(/^#/, "").split("/");
  return SECTIONS.some((s) => s.id === id) ? id : undefined;
}

/** Which .env variable sets each Settings field, for the "Set by … in .env" note. */
const ENV_VARIABLES: Record<string, string[]> = {
  time_zone: ["TZ_NAME"],
  tasks_inbox: ["TASKS_INBOX"],
  tailnet: ["TAILSCALE_PROXY", "TAILNET_USERS"],
};

/**
 * The variables locking a field, if it is still set in .env. A locked field is shown read-only
 * with "Set by TZ_NAME in .env. Remove it there to change it here."
 */
export function lockedBy(field: string, envOverrides: string[]): string[] | undefined {
  return envOverrides.includes(field) ? (ENV_VARIABLES[field] ?? [field]) : undefined;
}

/** Every IANA zone the browser knows, for the time zone search. */
export function timeZones(): string[] {
  const intl = Intl as typeof Intl & { supportedValuesOf?: (key: string) => string[] };
  return intl.supportedValuesOf?.("timeZone") ?? [];
}
