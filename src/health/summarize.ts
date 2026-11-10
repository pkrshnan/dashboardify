// Command line: compute health summaries for a range of dates, oldest first, e.g. to backfill
// history or after changing a calculation. Uses the server's .env and its Settings (time zone).
//
//   bun src/health/summarize.ts 2026-10-13 2026-11-03
//   bun src/health/summarize.ts 2026-11-03

import { loadStartup } from "../server/config";
import { configFromSettings } from "../settings/startup";
import { isIsoDate } from "../vault/time";
import { Vault } from "../vault/vault";
import { DailySummary } from "./daily-summary";
import { DerivedStore } from "./derived-store";
import { RawStore } from "./raw-store";

async function main(args: string[]): Promise<void> {
  const [from, to = from] = args;
  if (!(isIsoDate(from) && isIsoDate(to))) {
    console.error("usage: bun src/health/summarize.ts FROM [TO]   (dates as YYYY-MM-DD)");
    process.exit(2);
  }
  const config = await configFromSettings(loadStartup());
  const summary = new DailySummary(
    new RawStore(config.healthRawPath),
    new DerivedStore(config.healthDerivedPath),
    new Vault(config.vaultPath, config.timeZone),
    config.timeZone,
  );
  const last = Temporal.PlainDate.from(to);
  for (let day = Temporal.PlainDate.from(from); Temporal.PlainDate.compare(day, last) <= 0; ) {
    const result = await summary.run(day.toString());
    console.log(`${day}: ${result ? describe(result) : "no data"}`);
    day = day.add({ days: 1 });
  }
}

function describe(result: NonNullable<Awaited<ReturnType<DailySummary["run"]>>>): string {
  const parts = [
    result.night ? `slept ${Math.round(result.night.asleepMin)} min` : "no night",
    result.recovery ? `recovery ${Math.round(result.recovery.pct)}%` : null,
    result.day.strain === null ? null : `strain ${result.day.strain.toFixed(1)}`,
  ];
  return parts.filter((p) => p !== null).join(", ");
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
