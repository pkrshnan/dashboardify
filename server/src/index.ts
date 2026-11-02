import { serveStatic } from "hono/bun";
import { createApp } from "./app";
import { loadConfig } from "./config";

const config = loadConfig();
if (config.tokens.size === 0) console.warn("INGEST_TOKENS is empty: every /api request will be rejected");

const app = createApp(config);
// Static UI (currently the Today mock). Served last so /api and /healthz win.
app.use("/*", serveStatic({ root: new URL("../../web", import.meta.url).pathname }));

console.log(`dashboardify listening on :${config.port}, vault ${config.vaultPath}, tz ${config.timeZone}`);
export default { port: config.port, fetch: app.fetch };
