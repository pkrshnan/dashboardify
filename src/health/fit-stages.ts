// Command line: fit the sleep stages' HRV, breathing and DFA α1 levels to your own nights by EM,
// check the result against the guardrails, and (with --apply) make it live if it passed. Uses
// the server's .env and Settings.
//
//   bun src/health/fit-stages.ts                     last 60 nights, report only
//   bun src/health/fit-stages.ts 2026-11-04 2026-11-09
//   bun src/health/fit-stages.ts --apply             apply if it passed, then rerun summarize.ts
//
// See docs/health-feedback.md.

import { loadStartup } from "../server/config";
import { configFromSettings } from "../settings/startup";
import { isIsoDate, localDate } from "../vault/time";
import { Vault } from "../vault/vault";
import { DailySummary } from "./daily-summary";
import { DerivedStore } from "./derived-store";
import { fitStages, type StageNight } from "./feedback/stage-fit";
import { stageFitReport } from "./feedback/stage-report";
import { DEFAULT_EMISSIONS, type StageEmissions } from "./metrics/sleep-stages";
import { nextVersion, ParamsStore } from "./params";
import { RawStore } from "./raw-store";

const DEFAULT_DAYS = 60;

async function main(args: string[]): Promise<void> {
  const apply = args.includes("--apply");
  const config = await configFromSettings(loadStartup());
  const range = dateRange(
    args.filter((a) => a !== "--apply"),
    localDate(new Date(), config.timeZone),
  );
  if (!range) {
    console.error(
      "usage: bun src/health/fit-stages.ts [--apply] [FROM TO]   (dates as YYYY-MM-DD)",
    );
    process.exit(2);
  }
  const store = new ParamsStore(config.healthDerivedPath);
  const params = await store.load();
  const summary = new DailySummary(
    new RawStore(config.healthRawPath),
    new DerivedStore(config.healthDerivedPath),
    new Vault(config.vaultPath, config.timeZone),
    config.timeZone,
  );
  const fit = fitStages(await loadNights(summary, range), params.stages ?? DEFAULT_EMISSIONS);
  console.log(stageFitReport({ ...fit, ...range }));
  if (apply && fit.failed.length === 0) {
    const version = await applyStages(store, fit.fitted);
    console.log(`Applied as params v${version}. Rewrite history with:`);
    console.log(`  bun src/health/summarize.ts ${range.from} ${range.to}`);
  }
}

/** Make `stages` live as the next params version, keeping recovery's weights. */
export async function applyStages(store: ParamsStore, stages: StageEmissions): Promise<string> {
  const params = await store.load();
  const version = nextVersion(params.version);
  await store.save({ ...params, version, stages });
  return version;
}

/** FROM and TO as given, else the DEFAULT_DAYS nights to this morning's. */
function dateRange(args: string[], today: string): { from: string; to: string } | null {
  const end = Temporal.PlainDate.from(today);
  const [from = end.subtract({ days: DEFAULT_DAYS - 1 }).toString(), to = end.toString()] = args;
  return isIsoDate(from) && isIsoDate(to) ? { from, to } : null;
}

/** Each night in the range with an asleep epoch, oldest first, keyed by the morning it ended. */
async function loadNights(
  summary: DailySummary,
  range: { from: string; to: string },
): Promise<StageNight[]> {
  const nights: StageNight[] = [];
  const last = Temporal.PlainDate.from(range.to);
  for (
    let day = Temporal.PlainDate.from(range.from);
    Temporal.PlainDate.compare(day, last) <= 0;
  ) {
    const date = day.toString();
    const features = await summary.features(date);
    if (features?.some((f) => f.asleep)) {
      nights.push({ date, features });
    }
    day = day.add({ days: 1 });
  }
  return nights;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
