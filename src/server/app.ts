// The HTTP app: the web app's files, /healthz, and the v1 services behind sign-in. Each service
// lives in its own file under api/; this file only wires them up.

import { Hono } from "hono";
import { DailySummary } from "../health/daily-summary";
import { DerivedStore } from "../health/derived-store";
import { RawStore } from "../health/raw-store";
import { type CalendarSource, noCalendar } from "../home/calendar";
import { storeHomeDeps } from "../home/home";
import type { DeviceMatcher } from "../settings/devices";
import type { SetupCode } from "../settings/setup-code";
import { TaskStore } from "../vault/task-store";
import { Vault } from "../vault/vault";
import type { ActivityDeps } from "./api/activity";
import { type AuthEnv, bearerAuth } from "./auth";
import type { Config } from "./config";
import { type SettingsDeps, v1Services } from "./routes/v1";
import { v1Transport } from "./routes/v1-transport";
import { webRoutes } from "./routes/web";
import type { TailnetAuth } from "./tailnet";

export interface AppDeps {
  /** Who may call the API: the DeviceStore in settings.db, or a fixed list in tests. */
  devices: DeviceMatcher;
  /** settings.db, for the Settings and Device APIs and a live tasks inbox. */
  settings?: SettingsDeps;
  /** The first-run setup code, accepted only to add a device. */
  setupCode?: SetupCode;
  /** Tailnet sign-in as it is now; read per request. Defaults to `config.tailnet`. */
  tailnet?: () => TailnetAuth | null;
  vault?: Vault;
  /** Told about every stored strap upload, e.g. to recompute health summaries. */
  onSamples?: (stream: string, day: string) => void;
  calendar?: CalendarSource;
  /** Recomputes a day's health summary after a workout review; defaults to running it now. */
  recompute?: (date: string) => Promise<unknown>;
  /** The clock for the home screen; tests pin it. */
  now?: () => Date;
}

export function createApp(config: Config, deps: AppDeps): Hono<AuthEnv> {
  const vault = deps.vault ?? new Vault(config.vaultPath, config.timeZone);
  const general = deps.settings?.general;
  // The inbox in Settings applies to the next new task.
  const tasks = new TaskStore(vault, general ? () => general.get().tasksInbox : config.tasksInbox);
  const { raw, derived, activity } = healthStores(config, deps, vault);
  const home = storeHomeDeps({
    vault,
    tasks,
    raw,
    derived,
    calendar: deps.calendar ?? noCalendar,
    timeZone: config.timeZone,
  });

  const tailnet = deps.tailnet ?? (() => config.tailnet ?? null);
  const app = new Hono<AuthEnv>();
  app.get("/healthz", (c) => c.json({ ok: true }));
  const v1 = v1Transport(
    v1Services(vault, tasks, raw, home, activity, deps.now, deps.onSamples, deps.settings),
  );
  const api = new Hono<AuthEnv>();
  api.use("*", bearerAuth(deps.devices, tailnet, deps.setupCode));
  api.route("/", v1);
  app.route("/", webRoutes());
  app.route("/", api);
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}

/** The strap's stores, and the Activity service on them. A review recomputes the day with the daily
 * summary unless deps set another way. */
function healthStores(config: Config, deps: AppDeps, vault: Vault) {
  const raw = new RawStore(config.healthRawPath);
  const derived = new DerivedStore(config.healthDerivedPath);
  const summary = new DailySummary(raw, derived, vault, config.timeZone);
  const activity: ActivityDeps = {
    derived,
    raw,
    vault,
    timeZone: config.timeZone,
    recompute: deps.recompute ?? ((date: string) => summary.run(date)),
  };
  return { raw, derived, activity };
}
