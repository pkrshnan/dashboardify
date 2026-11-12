// Made-up nights for the demo's night view: bed around 23:30, then sleep cycles of about 90
// minutes, deep early in the night and REM longer towards morning, with a few brief wakings. The
// stage minutes and time asleep are added up from the runs, so the rows and the hypnogram agree.

import type { DerivedRow } from "../src/health/derived-store";

export interface DemoNight {
  /** Columns for the night's row in `nights`. */
  row: DerivedRow;
  /** Its stage runs, for `stages`. */
  runs: DerivedRow[];
}

type Stage = "awake" | "light" | "deep" | "rem";

const MIN = 60_000;

/**
 * The night you woke from on `date`, asleep for about `asleepMin`. `noise` gives numbers from
 * -0.5 to 0.5.
 */
export function demoNight(
  date: string,
  timeZone: string,
  asleepMin: number,
  noise: () => number,
): DemoNight {
  const bed = Temporal.PlainDate.from(date)
    .subtract({ days: 1 })
    .toZonedDateTime({ timeZone, plainTime: { hour: 23, minute: 30 } })
    .add({ minutes: Math.round(40 * noise()) }).epochMilliseconds;
  const plan: [Stage, number][] = [
    ["awake", 12 + Math.round(10 * noise())],
    ...cycles(asleepMin, noise),
  ];
  const runs: DerivedRow[] = [];
  let at = bed;
  for (const [stage, minutes] of plan) {
    runs.push({ start_ts: at, end_ts: at + minutes * MIN, stage });
    at += minutes * MIN;
  }
  const total = (stage: Stage) =>
    plan.filter(([s]) => s === stage).reduce((sum, [, m]) => sum + m, 0);
  const asleep = total("light") + total("deep") + total("rem");
  return {
    row: {
      bed_ts: bed,
      onset_ts: bed + (plan[0]?.[1] ?? 0) * MIN,
      wake_ts: at,
      tst_min: asleep,
      light_min: total("light"),
      deep_min: total("deep"),
      rem_min: total("rem"),
    },
    runs,
  };
}

/** Cycles of light, deep, light and REM until `asleepMin`, sometimes with a waking between. */
function cycles(asleepMin: number, noise: () => number): [Stage, number][] {
  const out: [Stage, number][] = [];
  let asleep = 0;
  for (let i = 0; asleep < asleepMin; i++) {
    const length = 90 + Math.round(16 * noise());
    const deep = Math.round(length * Math.max(0, 0.36 - 0.1 * i + 0.06 * noise()));
    const rem = Math.round(length * Math.min(0.42, 0.1 + 0.08 * i + 0.04 * noise()));
    const light = length - deep - rem;
    const first = Math.round(light * (0.55 + 0.2 * noise()));
    const parts: [Stage, number][] = [
      ["light", first],
      ["deep", deep],
      ["light", light - first],
      ["rem", rem],
    ];
    for (const [stage, minutes] of parts) {
      const left = asleepMin - asleep;
      const take = Math.min(minutes, left);
      if (take > 0) {
        out.push([stage, take]);
        asleep += take;
      }
    }
    if (asleep < asleepMin && noise() > 0) {
      out.push(["awake", 2 + Math.round(6 * (noise() + 0.5))]);
    }
  }
  return out;
}
