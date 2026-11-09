// The HTTP API. Each area lives in its own file under routes/; this file only wires them up.

import { Hono } from "hono";
import { DerivedStore } from "../health/derived-store";
import { RawStore } from "../health/raw-store";
import { type CalendarSource, noCalendar } from "../home/calendar";
import { HealthHistory } from "../home/health-history";
import type { DeviceMatcher } from "../settings/devices";
import { TaskStore } from "../vault/task-store";
import { Vault } from "../vault/vault";
import { type AuthEnv, bearerAuth } from "./auth";
import type { Config } from "./config";
import { healthRoutes } from "./routes/health";
import { homeRoutes } from "./routes/home";
import { journalRoutes } from "./routes/journal";
import { messageRoutes } from "./routes/messages";
import { sampleRoutes } from "./routes/samples";
import { taskRoutes } from "./routes/tasks";
import { todayRoutes } from "./routes/today";
import { v1Services } from "./routes/v1";
import { v1Transport } from "./routes/v1-transport";
import { webRoutes } from "./routes/web";

export interface AppDeps {
  /** Who may call the API: the DeviceStore in settings.db, or a fixed list in tests. */
  devices: DeviceMatcher;
  vault?: Vault;
  /** Told about every stored strap upload, e.g. to recompute health summaries. */
  onSamples?: (stream: string, day: string) => void;
  calendar?: CalendarSource;
  /** The clock for the home screen; tests pin it. */
  now?: () => Date;
}

export function createApp(config: Config, deps: AppDeps): Hono<AuthEnv> {
  const vault = deps.vault ?? new Vault(config.vaultPath, config.timeZone);
  const tasks = new TaskStore(vault, config.tasksInbox);
  const raw = new RawStore(config.healthRawPath);
  const home = {
    tasks,
    health: new HealthHistory(new DerivedStore(config.healthDerivedPath)),
    calendar: deps.calendar ?? noCalendar,
    sync: () => raw.readSync(),
    timeZone: config.timeZone,
  };

  const api = new Hono<AuthEnv>();
  api.use("*", bearerAuth(deps.devices, config.tailnet ?? null));
  api.route("/ingest/journal", journalRoutes(vault));
  api.route("/ingest/messages", messageRoutes(vault));
  api.route("/ingest/samples", sampleRoutes(raw, deps.onSamples));
  api.route("/today", todayRoutes(vault, config));
  api.route("/health", healthRoutes(vault, config));
  api.route("/tasks", taskRoutes(tasks, config));
  api.route("/home", homeRoutes(home, deps.now));

  const app = new Hono<AuthEnv>();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/api", api);
  const v1 = v1Transport(v1Services(vault, tasks, raw, home, deps.now, deps.onSamples));
  const modern = new Hono<AuthEnv>();
  modern.use("*", bearerAuth(deps.devices, config.tailnet ?? null));
  modern.route("/", v1);
  app.route("/", webRoutes());
  app.route("/", modern);
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}
