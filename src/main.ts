import { createApp } from "./server/app";
import { loadConfig } from "./server/config";

if (import.meta.main) {
  const config = loadConfig();
  if (config.tokens.size === 0) {
    console.warn("INGEST_TOKENS is empty: every /api request will be rejected");
  }
  const app = createApp(config);
  Bun.serve({ port: config.port, fetch: app.fetch });
  console.log(
    `dashboardify listening on :${config.port}, vault ${config.vaultPath}, tz ${config.timeZone}`,
  );
}
