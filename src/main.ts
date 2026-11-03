import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./server/app";
import { type Config, loadConfig } from "./server/config";
import { GitHistory } from "./vault/git-history";
import { Vault } from "./vault/vault";

/** Commit the vault's changes to git when it is a repo, and flush them on shutdown. */
async function startHistory(config: Config, vault: Vault): Promise<GitHistory | null> {
  if (config.history.mode === "off" || !existsSync(join(config.vaultPath, ".git"))) {
    return null;
  }
  const history = new GitHistory(config.vaultPath, { ...config.history, log: console.warn });
  await history.start();
  vault.onWrite(() => history.noteWrite());
  for (const signal of ["SIGINT", "SIGTERM"] as const) {
    process.on(signal, async () => {
      history.stop();
      await history.flush();
      process.exit(0);
    });
  }
  return history;
}

if (import.meta.main) {
  const config = loadConfig();
  if (config.tokens.size === 0) {
    console.warn("INGEST_TOKENS is empty: every /api request will be rejected");
  }
  const vault = new Vault(config.vaultPath, config.timeZone);
  const history = await startHistory(config, vault);
  const app = createApp(config, { vault, historyStatus: () => history?.status ?? null });
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(
    `dashboardify listening on :${config.port}, vault ${config.vaultPath}, tz ${config.timeZone}, git history ${history ? "on" : "off"}`,
  );
}
