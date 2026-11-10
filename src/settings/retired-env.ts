// Variables that used to configure the server and now live in Settings. Earlier releases copied
// them into settings.db on the first start; nothing reads them now, so a leftover one only gets
// a warning to remove it.

type Env = Record<string, string | undefined>;

const GENERAL = "set it in Settings › General";

/** Each retired variable, and where its value is set now. */
const RETIRED_ENV: Record<string, string> = {
  INGEST_TOKENS: "add devices in Settings › Devices or with bun run settings devices add",
  TZ_NAME: GENERAL,
  TASKS_INBOX: GENERAL,
  TAILSCALE_PROXY: GENERAL,
  TAILNET_USERS: GENERAL,
};

/** Warns once for each retired variable still set. */
export function warnRetiredEnv(env: Env, log: (message: string) => void = console.warn): void {
  for (const [name, instead] of Object.entries(RETIRED_ENV)) {
    if (env[name]?.trim()) {
      log(`${name} is no longer read. Remove it from .env and ${instead}.`);
    }
  }
}
