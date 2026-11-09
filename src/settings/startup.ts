// Opening Settings at startup, in the order docs/settings-plan.md gives: load the key, open
// settings.db and migrate, import .env once, apply variables still in the environment on top,
// then build the Config the rest of the server uses.

import {
  buildConfig,
  type Config,
  type InForce,
  type Startup,
  tailnetFrom,
} from "../server/config";
import type { TailnetAuth } from "../server/tailnet";
import { GeneralSettings } from "./core";
import { DeviceStore } from "./devices";
import { fromEnv, importEnvSettings, importEnvTokens, warnOverrides } from "./env-import";
import { loadKey } from "./key";
import { SecretBox } from "./secret-box";
import { SettingsStore } from "./store";

type Env = Record<string, string | undefined>;

export interface Opened {
  store: SettingsStore;
  devices: DeviceStore;
  general: GeneralSettings;
  config: Config;
  /** Tailnet sign-in as Settings say now, for each request. */
  tailnet: () => TailnetAuth | null;
  /** Variables still set in the environment, which win over Settings. */
  overrides: string[];
}

export async function openSettings(
  startup: Startup,
  env: Env,
  log: (message: string) => void = console.warn,
): Promise<Opened> {
  const key = await loadKey({ dataPath: startup.dataPath, keyFile: startup.keyFile });
  const store = await SettingsStore.open(startup.dataPath, new SecretBox(key));
  const devices = new DeviceStore(store);
  const general = new GeneralSettings(store);
  importEnvTokens(store, devices, env.INGEST_TOKENS, log);
  importEnvSettings(store, general, env, log);

  const { change, names: overrides } = fromEnv(env);
  warnOverrides(overrides, log);
  const inForce = (): InForce => ({ ...general.get(), ...change });
  const config = buildConfig(startup, inForce());
  if (devices.list().length === 0 && !config.tailnet) {
    log("No devices in Settings and no tailnet sign-in: every API request will be rejected.");
  }
  return { store, devices, general, config, tailnet: liveTailnet(inForce), overrides };
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
