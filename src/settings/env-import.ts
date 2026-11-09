// Moves configuration out of .env into settings.db, once. Each part is recorded separately in
// meta ("env_import.tokens"), so a part added in a later release still runs on an existing
// server. Values are logged by name, never by value.

import type { GeneralSettings, SettingsChange, StoredSettings } from "./core";
import { checkTimeZone } from "./core";
import type { DeviceStore } from "./devices";
import type { SettingsStore } from "./store";

const MIN_TOKEN_LENGTH = 16;

type Log = (message: string) => void;

/**
 * Imports INGEST_TOKENS ("iphone:abc…,mac:def…") as hashed devices, the first time only, so
 * phones and Shortcuts keep signing in with the tokens they have. After that the variable is
 * no longer read, and a warning says to remove it.
 */
export function importEnvTokens(
  store: SettingsStore,
  devices: DeviceStore,
  raw: string | undefined,
  log: Log = console.warn,
): void {
  const done = "env_import.tokens";
  if (isDone(store, done)) {
    if (raw?.trim()) {
      log("INGEST_TOKENS was imported into Settings and is no longer read. Remove it from .env.");
    }
    return;
  }
  const entries = parseTokens(raw ?? "");
  store.transaction(() => {
    for (const [name, token] of entries) {
      if (!devices.has(token)) {
        devices.add(name, token);
        log(`Imported the ${name} device token from INGEST_TOKENS.`);
      }
    }
    markDone(store, done);
  });
}

type Env = Record<string, string | undefined>;

/** The .env variables that became settings, and what each one sets. */
const ENV_SETTINGS: { name: string; read: (value: string) => SettingsChange }[] = [
  { name: "TZ_NAME", read: (value) => ({ timeZone: value }) },
  { name: "TASKS_INBOX", read: (value) => ({ tasksInbox: value }) },
  { name: "TAILSCALE_PROXY", read: (value) => ({ tailnetProxy: value }) },
  {
    name: "TAILNET_USERS",
    read: (value) => ({
      tailnetLogins: value
        .split(",")
        .map((login) => login.trim())
        .filter((login) => login !== ""),
    }),
  },
];

/** The settings set in `env`, and the names of the variables that set them. */
export function fromEnv(env: Env): { change: SettingsChange; names: string[] } {
  const change: SettingsChange = {};
  const names: string[] = [];
  for (const variable of ENV_SETTINGS) {
    const value = env[variable.name]?.trim();
    if (value) {
      Object.assign(change, variable.read(value));
      names.push(variable.name);
    }
  }
  if (change.timeZone) {
    checkTimeZone(change.timeZone, "TZ_NAME in the environment");
  }
  return { change, names };
}

/** Copies TZ_NAME, TASKS_INBOX and the tailnet variables into Settings, the first time only. */
export function importEnvSettings(
  store: SettingsStore,
  settings: GeneralSettings,
  env: Env,
  log: Log = console.warn,
): void {
  const done = "env_import.settings";
  if (isDone(store, done)) {
    return;
  }
  const { change, names } = fromEnv(env);
  store.transaction(() => {
    if (names.length > 0) {
      settings.update(change);
      log(`Imported ${names.join(", ")} into Settings.`);
    }
    markDone(store, done);
  });
}

/**
 * For one release a variable still set in the environment wins over Settings, so nothing
 * changes under you after the upgrade. `overrides` names them, for warnings and the page.
 */
export function withEnvOverrides(
  stored: StoredSettings,
  env: Env,
): { settings: StoredSettings; overrides: string[] } {
  const { change, names } = fromEnv(env);
  return { settings: { ...stored, ...change }, overrides: names };
}

export function warnOverrides(overrides: string[], log: Log = console.warn): void {
  for (const name of overrides) {
    log(`${name} is set in the environment and overrides Settings. Remove it from .env.`);
  }
}

/** "iphone:abc123,mac:def456" → [["iphone", "abc123"], ["mac", "def456"]] */
export function parseTokens(raw: string): [name: string, token: string][] {
  return raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "")
    .map(parseTokenEntry);
}

function parseTokenEntry(entry: string): [name: string, token: string] {
  const colon = entry.indexOf(":");
  if (colon <= 0 || colon === entry.length - 1) {
    throw new Error(`bad INGEST_TOKENS entry: ${entry.slice(0, Math.max(colon, 0))}:…`);
  }
  const name = entry.slice(0, colon);
  const token = entry.slice(colon + 1);
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`token for ${name} must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return [name, token];
}

function isDone(store: SettingsStore, key: string): boolean {
  return store.db.query("SELECT 1 FROM meta WHERE key = ?").get(key) !== null;
}

function markDone(store: SettingsStore, key: string): void {
  store.db.query("INSERT INTO meta (key, value) VALUES (?, ?)").run(key, new Date().toISOString());
}
