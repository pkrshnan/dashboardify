import homepage from "../web/index.html";
import { DailySummary } from "./health/daily-summary";
import { DerivedStore } from "./health/derived-store";
import { RawStore } from "./health/raw-store";
import { SummaryScheduler } from "./health/scheduler";
import { createApp } from "./server/app";
import { type Config, loadConfig } from "./server/config";
import { localDate } from "./vault/time";
import { Vault } from "./vault/vault";

const HOUR_MS = 3_600_000;

/** Health summaries rerun after strap uploads, and hourly for today in case nothing arrives. */
function startHealthSummaries(config: Config, vault: Vault): SummaryScheduler {
  const summary = new DailySummary(
    new RawStore(config.healthRawPath),
    new DerivedStore(config.healthDerivedPath),
    vault,
    config.timeZone,
  );
  const scheduler = new SummaryScheduler(summary, config.timeZone);
  const today = () => localDate(new Date(), config.timeZone);
  scheduler.touchDate(today());
  setInterval(() => scheduler.touchDate(today()), HOUR_MS);
  return scheduler;
}

if (import.meta.main) {
  const config = loadConfig();
  if (config.tokens.size === 0) {
    console.warn("INGEST_TOKENS is empty: every /api request will be rejected");
  }
  const vault = new Vault(config.vaultPath, config.timeZone);
  const scheduler = startHealthSummaries(config, vault);
  const app = createApp(config, {
    vault,
    onSamples: (_stream, day) => scheduler.touchUtcDay(day),
  });
  Bun.serve({
    port: config.port,
    // The web app: Bun bundles web/app.tsx and styles.css when the page is first requested.
    routes: { "/": homepage },
    fetch: app.fetch,
    development: process.env.NODE_ENV !== "production",
  });
  console.log(
    `dashboardify listening on :${config.port}, vault ${config.vaultPath}, tz ${config.timeZone}`,
  );
}
