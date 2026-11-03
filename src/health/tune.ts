// Command line: re-fit recovery's weights against your check-ins, test the result on past nights,
// and (with --apply) make it live if it earned it. Uses the same environment as the server.
//
//   bun src/health/tune.ts                     last 180 days, report only
//   bun src/health/tune.ts 2026-06-01 2026-11-03
//   bun src/health/tune.ts --apply             apply if worth it, then rerun summarize.ts
//
// See docs/health-feedback.md.

import { loadConfig } from "../server/config";
import { isIsoDate, localDate } from "../vault/time";
import { Vault } from "../vault/vault";
import { fromNightRow } from "./daily-summary";
import { DerivedStore } from "./derived-store";
import {
  type PastNight,
  ratedNights,
  shift,
  walkForward,
  worthApplying,
} from "./feedback/backtest";
import { refitWeights } from "./feedback/refit";
import { tuningReport } from "./feedback/report";
import { nextVersion, ParamsStore } from "./params";

const DEFAULT_DAYS = 180;

async function main(args: string[]): Promise<void> {
  const apply = args.includes("--apply");
  const config = loadConfig();
  const range = dateRange(
    args.filter((a) => a !== "--apply"),
    localDate(new Date(), config.timeZone),
  );
  if (!range) {
    console.error("usage: bun src/health/tune.ts [--apply] [FROM TO]   (dates as YYYY-MM-DD)");
    process.exit(2);
  }
  const store = new ParamsStore(config.healthDerivedPath);
  const params = await store.load();
  const nights = await loadNights(
    new DerivedStore(config.healthDerivedPath),
    new Vault(config.vaultPath, config.timeZone),
    range,
  );
  const refit = refitWeights(ratedNights(nights), params.recovery);
  const heldOut = walkForward(nights, params.recovery);
  const moved = shift(nights, params.recovery, refit.weights);
  const worth = refit.status === "fitted" && worthApplying(heldOut, moved);
  console.log(
    tuningReport({
      ...range,
      current: params.recovery,
      refit,
      heldOut,
      moved,
      worthApplying: worth,
    }),
  );
  if (apply && worth) {
    const version = nextVersion(params.version);
    await store.save({ ...params, version, recovery: refit.weights });
    console.log(`Applied as params v${version}. Rewrite history with:`);
    console.log(`  bun src/health/summarize.ts ${range.from} ${range.to}`);
  }
}

function dateRange(args: string[], today: string): { from: string; to: string } | null {
  const end = Temporal.PlainDate.from(today).subtract({ days: 1 });
  const [from = end.subtract({ days: DEFAULT_DAYS }).toString(), to = end.toString()] = args;
  return isIsoDate(from) && isIsoDate(to) ? { from, to } : null;
}

/** Every stored night in the range, oldest first, with that morning's feel rating if any. */
async function loadNights(
  derived: DerivedStore,
  vault: Vault,
  range: { from: string; to: string },
): Promise<PastNight[]> {
  const nights: PastNight[] = [];
  const last = Temporal.PlainDate.from(range.to);
  for (
    let day = Temporal.PlainDate.from(range.from);
    Temporal.PlainDate.compare(day, last) <= 0;
  ) {
    const date = day.toString();
    const row = await derived.read("nights", date);
    if (row) {
      const feel = (await vault.readDaily(date))?.frontmatter.feel;
      nights.push({
        date,
        signals: fromNightRow(row),
        feel: typeof feel === "number" ? feel : null,
      });
    }
    day = day.add({ days: 1 });
  }
  return nights;
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
