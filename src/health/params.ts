// Tunable numbers behind the scores, kept in one versioned file so the feedback loop can propose
// new values, test them on past nights and apply them without a code change.
//
// The live set is health-derived/params/current.json. Without it, the defaults below are used.
// Every derived row records the params version that produced it.

import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { isObject } from "../server/validate";

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
  if (!valid) {
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
  };
}

/** The next version string after `version` ("3" → "4"). */
export function nextVersion(version: string): string {
  const n = Number.parseInt(version, 10);
  return Number.isFinite(n) ? String(n + 1) : `${version}.1`;
}
