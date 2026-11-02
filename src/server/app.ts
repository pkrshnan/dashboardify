// The HTTP API. Each area lives in its own file under routes/; this file only wires them up.

import { Hono } from "hono";
import type { GitSyncStatus } from "../vault/git-sync";
import { Vault } from "../vault/vault";
import { type AuthEnv, bearerAuth } from "./auth";
import type { Config } from "./config";
import { healthRoutes } from "./routes/health";
import { journalRoutes } from "./routes/journal";
import { messageRoutes } from "./routes/messages";
import { reminderRoutes } from "./routes/reminders";
import { todayRoutes } from "./routes/today";

export interface AppDeps {
  vault?: Vault;
  /** Reported by GET /api/status. */
  gitStatus?: () => GitSyncStatus | null;
}

export function createApp(config: Config, deps: AppDeps = {}): Hono<AuthEnv> {
  const vault = deps.vault ?? new Vault(config.vaultPath, config.timeZone);

  const api = new Hono<AuthEnv>();
  api.use("*", bearerAuth(config.tokens));
  api.route("/ingest/journal", journalRoutes(vault));
  api.route("/ingest/health", healthRoutes(vault, config));
  api.route("/ingest/reminders", reminderRoutes(vault, config));
  api.route("/ingest/messages", messageRoutes(vault));
  api.route("/today", todayRoutes(vault, config));
  api.get("/status", (c) => c.json({ git: deps.gitStatus?.() ?? null }));

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
