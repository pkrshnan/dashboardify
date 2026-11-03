// The HTTP API. Each area lives in its own file under routes/; this file only wires them up.

import { Hono } from "hono";
import type { GitHistoryStatus } from "../vault/git-history";
import { TaskStore } from "../vault/task-store";
import { Vault } from "../vault/vault";
import { type AuthEnv, bearerAuth } from "./auth";
import type { Config } from "./config";
import { healthRoutes } from "./routes/health";
import { journalRoutes } from "./routes/journal";
import { messageRoutes } from "./routes/messages";
import { taskRoutes } from "./routes/tasks";
import { todayRoutes } from "./routes/today";

export interface AppDeps {
  vault?: Vault;
  /** Reported by GET /api/status. */
  historyStatus?: () => GitHistoryStatus | null;
}

export function createApp(config: Config, deps: AppDeps = {}): Hono<AuthEnv> {
  const vault = deps.vault ?? new Vault(config.vaultPath, config.timeZone);

  const api = new Hono<AuthEnv>();
  api.use("*", bearerAuth(config.tokens));
  api.route("/ingest/journal", journalRoutes(vault));
  api.route("/ingest/health", healthRoutes(vault, config));
  api.route("/ingest/messages", messageRoutes(vault));
  api.route("/today", todayRoutes(vault, config));
  api.get("/status", (c) => c.json({ gitHistory: deps.historyStatus?.() ?? null }));
  api.route("/tasks", taskRoutes(new TaskStore(vault, config.tasksInbox), config));

  const app = new Hono<AuthEnv>();
  app.get("/healthz", (c) => c.json({ ok: true }));
  app.route("/api", api);
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}
