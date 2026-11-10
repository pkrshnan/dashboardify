// Tunable numbers behind the scores, kept in one versioned file so the feedback loop can propose
// new values, test them on past nights and apply them without a code change.
//
// The live set is health-derived/params/current.json. Without it, the defaults below are used.
// Every derived row records the params version that produced it. Recovery's weights and the
// sleep stages' own emissions share the file and its version, so that one number says which
// params made a row.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "../parsed";
import { FITTED_FEATURES, SLEEP_STAGES, type StageEmissions } from "./metrics/sleep-stages";

/** How much each overnight signal counts toward recovery. Only their ratios matter. */
export interface RecoveryWeights {
  hrv: number;
  rhr: number;
  sleep: number;
  breathing: number;
}

export interface HealthParams {
  /** Bumped on every applied change: "1", "2", … */
  version: string;
  recovery: RecoveryWeights;
  /** Your HRV, breathing and DFA α1 levels per sleep stage (fit-stages.ts); absent: hand-set. */
  stages?: StageEmissions;
}

/** HRV dominates, as Whoop describes. See docs/health-metrics.md. */
export const DEFAULT_PARAMS: HealthParams = {
  version: "1",
  recovery: { hrv: 0.5, rhr: 0.25, sleep: 0.15, breathing: 0.1 },
};

export const WEIGHT_KEYS = ["hrv", "rhr", "sleep", "breathing"] as const;

export class ParamsStore {
  constructor(readonly root: string) {}

  get path(): string {
    return join(this.root, "params", "current.json");
  }

  /** The live params, or the defaults when none were ever applied. */
  async load(): Promise<HealthParams> {
    let text: string;
    try {
      text = await readFile(this.path, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") {
        return DEFAULT_PARAMS;
      }
      throw err;
    }
    const parsed = parseParams(JSON.parse(text));
    if (!parsed) {
      throw new Error(`${this.path} is not a valid params file`);
    }
    return parsed;
  }

  /** Make `params` live. The previous version is kept beside it as v<version>.json. */
  async save(params: HealthParams): Promise<void> {
    const archive = join(this.root, "params", `v${params.version}.json`);
    await mkdir(dirname(this.path), { recursive: true });
    const text = `${JSON.stringify(params, null, 2)}\n`;
    await writeFile(archive, text);
    const tmp = `${this.path}.${process.pid}.tmp`;
    await writeFile(tmp, text);
    await rename(tmp, this.path);
  }
}

export function parseParams(value: unknown): HealthParams | null {
  if (!(isObject(value) && typeof value.version === "string" && isObject(value.recovery))) {
    return null;
  }
  const weights = value.recovery;
  const valid = WEIGHT_KEYS.every((k) => typeof weights[k] === "number" && weights[k] >= 0);
  const stages = value.stages === undefined ? undefined : parseStages(value.stages);
  if (!valid || stages === null) {
    return null;
  }
  return {
    version: value.version,
    recovery: {
      hrv: weights.hrv as number,
      rhr: weights.rhr as number,
      sleep: weights.sleep as number,
      breathing: weights.breathing as number,
    },
    ...(stages ? { stages } : {}),
  };
}

/** A mean and a positive SD for every stage and fitted feature, or null. */
function parseStages(value: unknown): StageEmissions | null {
  const valid =
    isObject(value) &&
    SLEEP_STAGES.every((stage) => {
      const features = value[stage];
      return isObject(features) && FITTED_FEATURES.every((k) => isGaussian(features[k]));
    });
  return valid ? (value as unknown as StageEmissions) : null;
}

function isGaussian(value: unknown): boolean {
  return (
    isObject(value) &&
    typeof value.mean === "number" &&
    Number.isFinite(value.mean) &&
    typeof value.sd === "number" &&
    value.sd > 0
  );
}

/** The next version string after `version` ("3" → "4"). */
export function nextVersion(version: string): string {
  const n = Number.parseInt(version, 10);
  return Number.isFinite(n) ? String(n + 1) : `${version}.1`;
}
