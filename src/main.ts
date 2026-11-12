import { rmSync } from "node:fs";
import homepage from "../web/index.html";
import { CalendarAccounts } from "./calendar/accounts";
import { AgendaWriter } from "./calendar/agenda-block";
import { EventCache } from "./calendar/cache";
import { cacheSource } from "./calendar/source";
import { CalendarSync } from "./calendar/sync";
import { DailySummary } from "./health/daily-summary";
import { DerivedStore } from "./health/derived-store";
import { RawStore } from "./health/raw-store";
import { SummaryScheduler } from "./health/scheduler";
import { PHOTON_URL, Photon } from "./places/photon";
import { connectICloud } from "./server/api/calendar-accounts";
import { createApp } from "./server/app";
import { type Config, loadStartup } from "./server/config";
import { lockPath } from "./settings/rotate";
import { openSettings } from "./settings/startup";
import type { SettingsStore } from "./settings/store";
import { StravaAccounts } from "./strava/account";
import { RunCache } from "./strava/cache";
import { StravaClient } from "./strava/client";
import { StravaSync } from "./strava/sync";
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

/** Strava runs are polled into strava-cache.db; a day whose runs changed is recomputed. */
async function startStrava(
  store: SettingsStore,
  config: Config,
  scheduler: SummaryScheduler,
): Promise<RunCache> {
  const accounts = new StravaAccounts(store);
  const cache = await RunCache.open(config.dataPath);
  new StravaSync({
    accounts,
    cache,
    client: new StravaClient(accounts),
    timeZone: config.timeZone,
    onChanged: (dates) => {
      for (const date of dates) {
        scheduler.touchDate(date);
      }
    },
  }).start();
  return cache;
}

/** server.lock holds our pid while we run, so `bun run settings rotate-key` refuses. */
async function holdLock(dataPath: string): Promise<void> {
  const path = lockPath(dataPath);
  await Bun.write(path, String(process.pid));
  const release = () => {
    rmSync(path, { force: true });
    process.exit(0);
  };
  process.on("SIGINT", release);
  process.on("SIGTERM", release);
}

if (import.meta.main) {
  const opened = await openSettings(loadStartup(), process.env);
  await holdLock(opened.config.dataPath);
  const { config, devices, general, tailnet } = opened;
  const accounts = new CalendarAccounts(opened.store);
  // The home screen reads the cache; syncing rebuilds it if it is missing.
  const cache = await EventCache.open(config.dataPath);
  const calendar = cacheSource(cache, accounts);
  const vault = new Vault(config.vaultPath, config.timeZone);
  // Today's events go into the daily note's agenda block after each sync that changes them.
  const agenda = new AgendaWriter(vault, calendar, config.timeZone);
  const calendarSync = new CalendarSync({
    accounts,
    cache,
    connect: connectICloud,
    timeZone: config.timeZone,
    onPass: () => (accounts.list().length > 0 ? agenda.write() : Promise.resolve(false)),
  });
  calendarSync.start();
  const scheduler = startHealthSummaries(config, vault);
  await startStrava(opened.store, config, scheduler);
  const app = createApp(config, {
    devices,
    tailnet,
    setupCode: opened.setupCode,
    calendar,
    settings: {
      general,
      devices,
      calendars: { accounts, cache, sync: calendarSync },
      places: new Photon(process.env.PHOTON_URL || PHOTON_URL),
    },
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
    `dashboardify listening on :${config.port}, vault ${config.vaultPath}, data ${config.dataPath}, tz ${config.timeZone}`,
  );
}
