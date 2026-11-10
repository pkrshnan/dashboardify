// Command line: fit the sleep stage model's HR, movement and transition parts to sleep-lab
// nights, score it against H9's hand-set model by leaving one subject out, and write
// src/health/metrics/stage-params.json. Run by hand; nothing on the server calls it.
//
//   bun src/health/train-stages.ts DATASET_DIR [OUT]
//
// DATASET_DIR is PhysioNet sleep-accel 1.0.0 unzipped (Walch 2019, ODC-BY 1.0): the folder
// holding labels/, motion/ and heart_rate/. Download it yourself; it isn't checked in.
// See docs/health-metrics.md.

import { EPOCH_MS } from "./metrics/sleep-epochs";
import { type SleepStage, STATES, type StageParams, trainedModel } from "./metrics/sleep-stages";
import {
  type HeldOutNight,
  leaveOneOut,
  plausibleBounds,
  type Scores,
  score,
  shares,
} from "./staging/evaluate";
import { type FittedParts, fit } from "./staging/fit";
import { HAND_SET_MODEL } from "./staging/hand-set";
import { type LabelledNight, loadNight, subjects } from "./staging/walch";

const DEFAULT_OUT = "src/health/metrics/stage-params.json";
/** A night with HR in fewer epochs than this is mostly a recording gap; it is left out. */
const MIN_HR_COVERAGE = 0.8;
/** Plausibility bounds come from held-out nights at least this long asleep, like a real night. */
const BOUNDS_MIN_ASLEEP_MIN = 300;
/** While fitting a fold, plausibility doesn't matter. */
const OPEN_BOUNDS: Record<SleepStage, number[]> = { light: [0, 1], deep: [0, 1], rem: [0, 1] };

async function main(args: string[]): Promise<void> {
  const [dir, out = DEFAULT_OUT] = args;
  if (!dir) {
    console.error("usage: bun src/health/train-stages.ts DATASET_DIR [OUT]");
    process.exit(2);
  }
  const nights = await loadNights(dir);
  const trained = leaveOneOut(nights, (others) => modelOf(fit(others)));
  const handSet = leaveOneOut(nights, () => HAND_SET_MODEL);
  const plausible = plausibleBounds(trained, BOUNDS_MIN_ASLEEP_MIN);
  console.log(report(score(trained), score(handSet)));
  console.log(nightTable(trained));
  console.log(`Plausible shares: ${JSON.stringify(plausible)}`);
  const params: StageParams = { provenance: provenance(nights), ...fit(nights), plausible };
  await Bun.write(out, `${JSON.stringify(params, null, 2)}\n`);
  console.log(`Wrote ${out}; run bun run format.`);
}

async function loadNights(dir: string): Promise<LabelledNight[]> {
  const nights: LabelledNight[] = [];
  for (const id of await subjects(dir)) {
    const night = await loadNight(dir, id);
    const withHr = night ? night.features.filter((f) => f.hrZ !== null).length : 0;
    if (night && withHr >= MIN_HR_COVERAGE * night.features.length) {
      nights.push(night);
    } else {
      console.log(`Left out ${id}: HR in ${withHr} of ${night?.features.length ?? 0} epochs`);
    }
  }
  return nights;
}

function modelOf(parts: FittedParts) {
  return trainedModel({ provenance: {}, ...parts, plausible: OPEN_BOUNDS });
}

function provenance(nights: LabelledNight[]): StageParams["provenance"] {
  const epochs = nights.reduce((sum, n) => sum + n.truth.filter((t) => t !== null).length, 0);
  return {
    dataset:
      "Walch O, Huang Y, Forger D, Goldstein C. Motion and heart rate from a wrist-worn wearable and labeled sleep from polysomnography. PhysioNet sleep-accel",
    version: "1.0.0",
    url: "https://physionet.org/content/sleep-accel/1.0.0/",
    licence: "ODC-BY 1.0 (Open Data Commons Attribution): credit Walch et al. 2019 and PhysioNet",
    script: "src/health/train-stages.ts",
    subjects: nights.length,
    epochs,
  };
}

const pct = (v: number) => `${Math.round(100 * v)}%`;
const two = (v: number) => v.toFixed(2);

/** Trained against hand-set, one row each, pooled over every held-out epoch. */
function report(trained: Scores, handSet: Scores): string {
  const row = (name: string, s: Scores) =>
    [
      name.padEnd(9),
      pct(s.accuracy),
      two(s.kappa),
      two(s.meanNightKappa),
      two(s.kappa3),
      ...s.recall.map(pct),
      ...(["light", "deep", "rem"] as const).map((k) => pct(s.predicted[k])),
    ].join("\t");
  const header = [
    "model    ",
    "acc",
    "κ",
    "κ/night",
    "κ W/N/R",
    ...STATES.map((s) => `${s} rec`),
    "light",
    "deep",
    "REM",
  ];
  const truth = (["light", "deep", "rem"] as const).map((k) => pct(trained.truth[k])).join("\t");
  return [
    header.join("\t"),
    row("trained", trained),
    row("hand-set", handSet),
    `PSG shares\t${truth}`,
  ].join("\n");
}

/** Each held-out night's predicted shares against the lab's. */
function nightTable(nights: HeldOutNight[]): string {
  return nights
    .map((n) => {
      const p = shares(n.predicted);
      const t = shares(n.truth);
      const asleepMin = (n.predicted.filter((s) => s !== "awake").length * EPOCH_MS) / 60_000;
      const both = (k: SleepStage) => `${pct(p[k])}/${pct(t[k])}`;
      return `${n.id.padEnd(8)} ${Math.round(asleepMin)} min  light ${both("light")}  deep ${both("deep")}  REM ${both("rem")}`;
    })
    .join("\n");
}

if (import.meta.main) {
  await main(process.argv.slice(2));
}
