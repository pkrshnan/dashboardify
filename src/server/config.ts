import { resolve } from "node:path";

export interface Config {
  vaultPath: string;
  port: number;
  timeZone: string;
  /** Vault-relative file that new tasks are appended to. */
  tasksInbox: string;
  /** device name -> bearer token */
  tokens: Map<string, string>;
  history: {
    /** "auto" commits when the vault is a git repo; "off" never touches git. */
    mode: "auto" | "off";
    commitDelayMs: number;
    sweepIntervalMs: number;
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const vault = env.VAULT_PATH;
  if (!vault) {
    throw new Error("VAULT_PATH is required");
  }

  const timeZone = env.TZ_NAME ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Throws a RangeError on an unknown zone, which is what we want at startup.
  new Intl.DateTimeFormat("en-CA", { timeZone });

  return {
    vaultPath: resolve(vault),
    port: Number(env.PORT ?? 8787),
    timeZone,
    tasksInbox: env.TASKS_INBOX ?? "Inbox.md",
    tokens: parseTokens(env.INGEST_TOKENS ?? ""),
    history: {
      mode: env.GIT_HISTORY === "off" ? "off" : "auto",
      commitDelayMs: Number(env.GIT_COMMIT_DELAY_MS ?? 30_000),
      sweepIntervalMs: Number(env.GIT_SWEEP_INTERVAL_MS ?? 600_000),
    },
  };
}

const MIN_TOKEN_LENGTH = 16;

/** "iphone:abc123,mac:def456" -> Map { iphone => abc123, mac => def456 } */
export function parseTokens(raw: string): Map<string, string> {
  const entries = raw
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry !== "");
  return new Map(entries.map(parseTokenEntry));
}

function parseTokenEntry(entry: string): [device: string, token: string] {
  const colon = entry.indexOf(":");
  if (colon <= 0 || colon === entry.length - 1) {
    throw new Error(`bad INGEST_TOKENS entry: ${entry}`);
  }
  const device = entry.slice(0, colon);
  const token = entry.slice(colon + 1);
  if (token.length < MIN_TOKEN_LENGTH) {
    throw new Error(`token for ${device} must be at least ${MIN_TOKEN_LENGTH} characters`);
  }
  return [device, token];
}
