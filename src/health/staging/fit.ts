// Fitting the stage model's HR, movement and transition parts to labelled nights, by counting.
//
// Everything is fitted to what the decoder can say. After onset it chooses freely, so every
// labelled epoch there counts as its PSG stage, awake included. Before onset scoreEpochs fixes
// awake: its awake epochs count only as awake, and its asleep ones only as a sleep stage, with lab
// wake counted as light, the nearest.

import type { EpochFeatures } from "../metrics/sleep-features";
import {
  afterOnset,
  detrendHr,
  epochTime,
  HEART_CUES,
  heartCue,
  STATES,
  type Stage,
  type StageParams,
} from "../metrics/sleep-stages";
import { mean, sd } from "../metrics/stats";
import type { LabelledNight } from "./walch";

/**
 * Movement bins in degrees: still, a twitch, a small shift, and a posture change as
 * sleep-epochs.ts counts one.
 */
export const MOVEMENT_EDGES_DEG = [0.5, 2, 5];
export const BIN_MIN = 30;
/** Bins after this are pooled into the last: few lab nights run past 8 h. */
const BINS = 16;
/**
 * Each 30-minute bin's row leans on the night-wide row as if it had this many more epochs, so a
 * bin with few visits to a stage doesn't swing to 0 or 1 on a handful of them.
 */
const PRIOR_EPOCHS = 100;
/** Added to every night-wide count so a transition never seen is rare, not impossible. */
const PSEUDO_COUNT = 0.5;

export type FittedParts = Omit<StageParams, "provenance" | "plausible">;

export function fit(nights: LabelledNight[]): FittedParts {
  const prepared = nights.map((n) => ({ ...n, features: detrendHr(n.features) }));
  return {
    hr: fitHr(prepared),
    movement: {
      edgesDeg: MOVEMENT_EDGES_DEG,
      p: fitBins(prepared, movementBin, MOVEMENT_EDGES_DEG.length + 1),
    },
    heartCue: { p: fitBins(prepared, heartCue, HEART_CUES) },
    transitions: fitTransitions(prepared),
  };
}

/**
 * Each epoch whose state the decoder chooses, with the lab's stage: after onset all of them,
 * before it the asleep-scored ones the lab put in a sleep stage.
 */
function freeEpochs(nights: LabelledNight[]): { f: EpochFeatures; stage: Stage }[] {
  return nights.flatMap((n) =>
    n.features.flatMap((f, i) => {
      const stage = n.truth[i];
      if (!stage) {
        return [];
      }
      return afterOnset(f) || (f.asleep && stage !== "awake") ? [{ f, stage }] : [];
    }),
  );
}

function perStage<T>(one: (stage: Stage) => T): Record<Stage, T> {
  return { awake: one("awake"), light: one("light"), deep: one("deep"), rem: one("rem") };
}

/** HR Gaussians over the epochs without an arousal, which heartCue scores instead. */
function fitHr(nights: LabelledNight[]): FittedParts["hr"] {
  const epochs = freeEpochs(nights);
  return perStage((stage) => {
    const values = epochs.flatMap((e) =>
      e.stage === stage && e.f.hrZ !== null && !e.f.arousal ? [e.f.hrZ] : [],
    );
    return { mean: round(mean(values) ?? 0), sd: round(sd(values) ?? 1) };
  });
}

function movementBin(f: EpochFeatures): number {
  return MOVEMENT_EDGES_DEG.filter((edge) => f.movementDeg >= edge).length;
}

/** Share of each stage's epochs in each bin of `binOf`, with one added to every bin. */
function fitBins(
  nights: LabelledNight[],
  binOf: (f: EpochFeatures) => number,
  size: number,
): Record<Stage, number[]> {
  const epochs = freeEpochs(nights);
  return perStage((stage) => {
    const counts = new Array<number>(size).fill(1);
    for (const e of epochs.filter((x) => x.stage === stage)) {
      const bin = binOf(e.f);
      counts[bin] = (counts[bin] ?? 0) + 1;
    }
    const total = counts.reduce((sum, c) => sum + c, 0);
    return counts.map((c) => round(c / total));
  });
}

/** What the decoder should ideally output per epoch; null where the lab didn't score. */
export function target(night: LabelledNight): (Stage | null)[] {
  return night.features.map((f, i) => {
    const stage = night.truth[i] ?? null;
    if (afterOnset(f)) {
      return stage;
    }
    if (!f.asleep) {
      return "awake";
    }
    return stage === "awake" ? "light" : stage;
  });
}

interface Counts {
  before: number[][];
  bins: number[][][];
}

function countTransitions(nights: LabelledNight[]): Counts {
  const zeros = () => STATES.map(() => STATES.map(() => 0));
  const counts: Counts = { before: zeros(), bins: Array.from({ length: BINS }, zeros) };
  const matrixAt = (t: number) =>
    t < 0 ? counts.before : counts.bins[Math.min(BINS - 1, Math.floor(t / BIN_MIN))];
  for (const night of nights) {
    const seq = target(night).map((s) => (s === null ? -1 : STATES.indexOf(s)));
    for (let i = 1; i < seq.length; i++) {
      add(matrixAt(epochTime(night.features, i)), seq[i - 1] ?? -1, seq[i] ?? -1);
    }
  }
  return counts;
}

/** One transition; a pair with an unscored end doesn't count. */
function add(matrix: number[][] | undefined, from: number, to: number): void {
  const row = matrix?.[from];
  if (row && to >= 0) {
    row[to] = (row[to] ?? 0) + 1;
  }
}

function fitTransitions(nights: LabelledNight[]): FittedParts["transitions"] {
  const counts = countTransitions(nights);
  const all = sumMatrices([counts.before, ...counts.bins]).map((row) =>
    normalise(row.map((c) => c + PSEUDO_COUNT)),
  );
  const shrink = (matrix: number[][]) =>
    matrix.map((row, from) =>
      normalise(row.map((c, to) => c + PRIOR_EPOCHS * (all[from]?.[to] ?? 0))).map(round),
    );
  return {
    binMin: BIN_MIN,
    beforeOnset: shrink(counts.before),
    sinceOnset: counts.bins.map(shrink),
  };
}

function sumMatrices(matrices: number[][][]): number[][] {
  return STATES.map((_, from) =>
    STATES.map((_, to) => matrices.reduce((sum, m) => sum + (m[from]?.[to] ?? 0), 0)),
  );
}

function normalise(row: number[]): number[] {
  const total = row.reduce((sum, v) => sum + v, 0);
  return row.map((v) => (total > 0 ? v / total : 1 / row.length));
}

/** Four significant figures: plenty for a likelihood, and a readable file. */
function round(value: number): number {
  return Number(value.toPrecision(4));
}
