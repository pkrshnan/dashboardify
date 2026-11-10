// Opening Settings at startup, in the order docs/settings.md gives: load the key, open
// settings.db and migrate, import .env once, apply variables still in the environment on top,
// then build the Config the rest of the server uses.

import { join } from "node:path";
import {
  buildConfig,
  type Config,
  type InForce,
  type Startup,
  tailnetFrom,
} from "../server/config";
import type { TailnetAuth } from "../server/tailnet";
import { GeneralSettings, type SettingsChange } from "./core";
import { DeviceStore } from "./devices";
import { fromEnv, importEnvSettings, importEnvTokens, warnOverrides } from "./env-import";
import { loadKey } from "./key";
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
  /** Variables still set in the environment, which win over Settings, and their values. */
  overrides: string[];
  envChange: SettingsChange;
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
  importEnvTokens(store, devices, env.INGEST_TOKENS, log);
  importEnvSettings(store, general, env, log);

  const { change, names: overrides } = fromEnv(env);
  warnOverrides(overrides, log);
  const inForce = (): InForce => ({ ...general.get(), ...change });
  const config = buildConfig(startup, inForce());
  const setupCode = new SetupCode();
  if (devices.list().length === 0 && !config.tailnet) {
    const code = setupCode.issue();
    log(
      `No devices yet. Open http://localhost:${config.port} and enter setup code ${code} (valid 15 minutes).`,
    );
  }
  const tailnet = liveTailnet(inForce);
  return { store, devices, general, config, tailnet, overrides, envChange: change, setupCode };
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
