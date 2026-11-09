// Moves configuration out of .env into settings.db, once. Each part is recorded separately in
// meta ("env_import.tokens"), so a part added in a later release still runs on an existing
// server. Values are logged by name, never by value.

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
