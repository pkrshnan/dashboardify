import { dirname, join, resolve } from "node:path";
import { parseTailnet, type TailnetAuth } from "./tailnet";

export interface Config {
  vaultPath: string;
  port: number;
  timeZone: string;
  /** Folder for raw health samples (Parquet), outside the vault. */
  healthRawPath: string;
  /** Folder for computed health tables (Parquet), rebuildable from healthRawPath. */
  healthDerivedPath: string;
  /** Vault-relative file that new tasks are appended to. */
  tasksInbox: string;
  /** settings.db and secret.key live here, outside the vault. */
  dataPath: string;
  /** SECRET_KEY_FILE: use this key file instead of $DATA_PATH/secret.key. */
  keyFile?: string;
  /** Sign-in through Tailscale Serve, or null for tokens only. */
  tailnet?: TailnetAuth | null;
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
    healthRawPath: resolve(env.HEALTH_RAW_PATH ?? join(dirname(resolve(vault)), "health-raw")),
    healthDerivedPath: resolve(
      env.HEALTH_DERIVED_PATH ?? join(dirname(resolve(vault)), "health-derived"),
    ),
    tasksInbox: env.TASKS_INBOX ?? "Inbox.md",
    dataPath: resolve(env.DATA_PATH ?? "data"),
    keyFile: env.SECRET_KEY_FILE ? resolve(env.SECRET_KEY_FILE) : undefined,
    tailnet: parseTailnet(env.TAILSCALE_PROXY, env.TAILNET_USERS),
  };
}
