import { existsSync } from "node:fs";
import { join } from "node:path";
import { createApp } from "./server/app";
import { loadConfig } from "./server/config";
import { GitSync } from "./vault/git-sync";
import { Vault } from "./vault/vault";

if (import.meta.main) {
  const config = loadConfig();
  if (config.tokens.size === 0) {
    console.warn("INGEST_TOKENS is empty: every /api request will be rejected");
  }

  const vault = new Vault(config.vaultPath, config.timeZone);
  let git: GitSync | null = null;
  if (config.git.mode === "auto" && existsSync(join(config.vaultPath, ".git"))) {
    git = new GitSync(config.vaultPath, config.git);
    await git.start();
    vault.onWrite((path) => git?.noteWrite(path));
    for (const signal of ["SIGINT", "SIGTERM"] as const) {
      process.on(signal, async () => {
        git?.stop();
        await git?.flush().catch(() => undefined);
        process.exit(0);
      });
    }
  }

  const app = createApp(config, { vault, gitStatus: () => git?.status ?? null });
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(
    `dashboardify listening on :${config.port}, vault ${config.vaultPath}, tz ${config.timeZone}, git ${git ? "on" : "off"}`,
  );
}
