import { resolve } from "node:path";

export interface Config {
  vaultPath: string;
  port: number;
  timeZone: string;
  /** device name -> bearer token */
  tokens: Map<string, string>;
  git: {
    /** "auto" syncs when the vault is a git repo; "off" never touches git. */
    mode: "auto" | "off";
    commitDelayMs: number;
    pullIntervalMs: number;
  };
}

export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const vault = env.VAULT_PATH;
  if (!vault) throw new Error("VAULT_PATH is required");

  const timeZone = env.TZ_NAME ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  // Throws a RangeError on an unknown zone, which is what we want at startup.
  new Intl.DateTimeFormat("en-CA", { timeZone });

  return {
    vaultPath: resolve(vault),
    port: Number(env.PORT ?? 8787),
    timeZone,
    tokens: parseTokens(env.INGEST_TOKENS ?? ""),
    git: {
      mode: env.GIT_SYNC === "off" ? "off" : "auto",
      commitDelayMs: Number(env.GIT_COMMIT_DELAY_MS ?? 30_000),
      pullIntervalMs: Number(env.GIT_PULL_INTERVAL_MS ?? 300_000),
    },
  };
}

/** "iphone:abc123,mac:def456" -> Map { iphone => abc123, mac => def456 } */
export function parseTokens(raw: string): Map<string, string> {
  const tokens = new Map<string, string>();
  for (const pair of raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)) {
    const i = pair.indexOf(":");
    if (i <= 0 || i === pair.length - 1) throw new Error(`bad INGEST_TOKENS entry: ${pair}`);
    const token = pair.slice(i + 1);
    if (token.length < 16) throw new Error(`token for ${pair.slice(0, i)} must be at least 16 characters`);
    tokens.set(pair.slice(0, i), token);
  }
  return tokens;
}
