// Opening Settings at startup, in the order docs/settings.md gives: load the key, open
// settings.db and migrate, warn about retired .env variables, then build the Config the rest of
// the server uses.

import { join } from "node:path";
import {
  buildConfig,
  type Config,
  DEFAULT_SETTINGS,
  type InForce,
  type Startup,
  tailnetFrom,
} from "../server/config";
import type { TailnetAuth } from "../server/tailnet";
import { GeneralSettings } from "./core";
import { DeviceStore } from "./devices";
import { loadKey } from "./key";
import { warnRetiredEnv } from "./retired-env";
import { SecretBox } from "./secret-box";
import { SetupCode } from "./setup-code";
import { KeyMismatch, SettingsStore } from "./store";

type Env = Record<string, string | undefined>;

export interface Opened {
  store: SettingsStore;
  devices: DeviceStore;
  general: GeneralSettings;
  config: Config;
  /** Tailnet sign-in as Settings say now, for each request. */
  tailnet: () => TailnetAuth | null;
  /** Issued only on a fresh install; inactive otherwise. */
  setupCode: SetupCode;
}

export async function openSettings(
  startup: Startup,
  env: Env,
  log: (message: string) => void = console.warn,
): Promise<Opened> {
  const key = await loadKey({ dataPath: startup.dataPath, keyFile: startup.keyFile });
  const store = await openStore(startup, key);
  const devices = new DeviceStore(store);
  const general = new GeneralSettings(store);
  warnRetiredEnv(env, log);

  const config = buildConfig(startup, general.get());
  const setupCode = new SetupCode();
  if (devices.list().length === 0 && !config.tailnet) {
    const code = setupCode.issue();
    log(
      `No devices yet. Open http://localhost:${config.port} and enter setup code ${code} (valid 15 minutes).`,
    );
  }
  const tailnet = liveTailnet(() => general.get());
  return { store, devices, general, config, tailnet, setupCode };
}

/**
 * The config the server runs with, for command-line tools such as summarize.ts: the time zone and
 * inbox come from Settings, so a tool files data under the same days as the server. Before the
 * first start there is no settings.db, and the defaults apply.
 */
export async function configFromSettings(startup: Startup): Promise<Config> {
  if (!(await Bun.file(join(startup.dataPath, "settings.db")).exists())) {
    return buildConfig(startup, DEFAULT_SETTINGS);
  }
  const key = await loadKey({ dataPath: startup.dataPath, keyFile: startup.keyFile });
  const store = await openStore(startup, key);
  try {
    return buildConfig(startup, new GeneralSettings(store).get());
  } finally {
    store.close();
  }
}

/** Opens settings.db, saying what to do if a rotate-key stopped before renaming the new key. */
async function openStore(startup: Startup, key: Uint8Array): Promise<SettingsStore> {
  try {
    return await SettingsStore.open(startup.dataPath, new SecretBox(key));
  } catch (error) {
    const keyPath = startup.keyFile ?? join(startup.dataPath, "secret.key");
    if (error instanceof KeyMismatch && (await Bun.file(`${keyPath}.new`).exists())) {
      throw new Error(
        `${keyPath} doesn't match settings.db, but ${keyPath}.new does: a rotate-key was interrupted. Move ${keyPath}.new to ${keyPath} and start again.`,
      );
    }
    throw error;
  }
}

/** Re-reads tailnet sign-in only when its settings change ("gateway" reads /proc each time). */
function liveTailnet(inForce: () => InForce): () => TailnetAuth | null {
  let seen = "";
  let auth: TailnetAuth | null = null;
  return () => {
    const settings = inForce();
    const now = JSON.stringify([settings.tailnetProxy, settings.tailnetLogins]);
    if (now !== seen) {
      auth = tailnetFrom(settings);
      seen = now;
    }
    return auth;
  };
}
