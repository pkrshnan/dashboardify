import { dirname, join, resolve } from "node:path";
import { checkTimeZone, type StoredSettings } from "../settings/core";
import { withEnvOverrides } from "../settings/env-import";
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

/** Values needed before settings.db can be opened. Everything else comes from Settings. */
export type Startup = Pick<
  Config,
  "vaultPath" | "port" | "healthRawPath" | "healthDerivedPath" | "dataPath" | "keyFile"
>;

/** The settings in force: from settings.db, with any variable still in .env on top. */
export type InForce = Pick<
  StoredSettings,
  "timeZone" | "tasksInbox" | "tailnetProxy" | "tailnetLogins"
>;

export function loadStartup(env: Record<string, string | undefined> = process.env): Startup {
  const vault = env.VAULT_PATH;
  if (!vault) {
    throw new Error("VAULT_PATH is required");
  }
  return {
    vaultPath: resolve(vault),
    port: Number(env.PORT ?? 8787),
    healthRawPath: resolve(env.HEALTH_RAW_PATH ?? join(dirname(resolve(vault)), "health-raw")),
    healthDerivedPath: resolve(
      env.HEALTH_DERIVED_PATH ?? join(dirname(resolve(vault)), "health-derived"),
    ),
    dataPath: resolve(env.DATA_PATH ?? "data"),
    keyFile: env.SECRET_KEY_FILE ? resolve(env.SECRET_KEY_FILE) : undefined,
  };
}

/** The full config. An unset time zone means the server's own; a bad one stops startup. */
export function buildConfig(startup: Startup, settings: InForce): Config {
  const timeZone = settings.timeZone ?? Intl.DateTimeFormat().resolvedOptions().timeZone;
  checkTimeZone(timeZone, "Settings time zone");
  return {
    ...startup,
    timeZone,
    tasksInbox: settings.tasksInbox,
    tailnet: tailnetFrom(settings),
  };
}

export function tailnetFrom(settings: InForce): TailnetAuth | null {
  return parseTailnet(settings.tailnetProxy, settings.tailnetLogins.join(","));
}

/** Config from the environment alone, as before Settings: for tests and the demo. */
export function loadConfig(env: Record<string, string | undefined> = process.env): Config {
  const defaults = { tasksInbox: "Inbox.md", tailnetLogins: [], updateTime: "" };
  return buildConfig(loadStartup(env), withEnvOverrides(defaults, env).settings);
}
