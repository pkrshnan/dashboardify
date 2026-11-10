// Reading Walch 2019's sleep-lab nights (PhysioNet sleep-accel 1.0.0) and making them look like
// the strap's before our own code turns them into epoch features.
//
// The Apple Watch gives raw acceleration at about 50 Hz and PPG heart rate every few seconds;
// the strap gives a gravity vector and HR once a second. So acceleration is averaged to 1 Hz,
// which keeps gravity and drops the jitter that rawAngleChanges would otherwise count as
// movement, and HR is interpolated to 1 Hz. The files are untrusted: every line is parsed as
// numbers and anything else is skipped.

import { readdir } from "node:fs/promises";
import { join } from "node:path";
import { rawAngleChanges } from "../metrics/sleep";
import { EPOCH_MS, scoreEpochs, sleepTimes } from "../metrics/sleep-epochs";
import { type EpochFeatures, epochFeatures } from "../metrics/sleep-features";
import type { Stage } from "../metrics/sleep-stages";
import type { Accel, HeartRate, Span } from "../metrics/types";

/** Any fixed instant: the files count seconds from the start of the PSG recording. */
const T0 = Date.UTC(2019, 0, 1);
/** Longer HR gaps stay gaps, so those epochs score awake as a strap gap would. */
const MAX_HR_GAP_S = 60;
/** Walch's PSG labels: 0 wake, 1–4 N1–N4 (R&K), 5 REM; -1 unscored. */
const LABELS: Record<number, Stage> = {
  0: "awake",
  1: "light",
  2: "light",
  3: "deep",
  4: "deep",
  5: "rem",
};

export interface LabelledNight {
  id: string;
  features: EpochFeatures[];
  /** The PSG stage of each epoch, null where unscored. */
  truth: (Stage | null)[];
}

/** Subject ids, from the labels folder. */
export async function subjects(dir: string): Promise<string[]> {
  const names = await readdir(join(dir, "labels"));
  return names
    .map((n) => /^(\d+)_labeled_sleep\.txt$/.exec(n)?.[1])
    .filter((id): id is string => id !== undefined)
    .sort();
}

export async function loadNight(dir: string, id: string): Promise<LabelledNight | null> {
  const text = (folder: string, suffix: string) =>
    Bun.file(join(dir, folder, `${id}${suffix}`)).text();
  const labels = parseRows(await text("labels", "_labeled_sleep.txt"), 2);
  const window = scoredSpan(labels);
  if (!window) {
    return null;
  }
  const accel = gravity(parseRows(await text("motion", "_acceleration.txt"), 4), window);
  const heartRate = heartRateAt1Hz(
    parseRows(await text("heart_rate", "_heartrate.txt"), 2),
    window,
  );
  return { id, features: features(window, accel, heartRate), truth: truth(labels, window) };
}

/** Our pipeline, as summary.ts runs it, over the PSG's scored span. There is no RR. */
export function features(window: Span, accel: Accel[], heartRate: HeartRate[]): EpochFeatures[] {
  const changes = rawAngleChanges(accel);
  const epochs = scoreEpochs(window, changes, heartRate);
  const { onset } = sleepTimes(window, epochs);
  return epochFeatures({ window, epochs, onset, changes, heartRate, beats: [] });
}

/** Rows of `width` numbers, split on spaces or commas; other lines are dropped. */
export function parseRows(text: string, width: number): number[][] {
  const rows: number[][] = [];
  for (const line of text.split("\n")) {
    const cells = line
      .trim()
      .split(/[\s,]+/)
      .map(Number);
    if (cells.length === width && cells.every(Number.isFinite)) {
      rows.push(cells);
    }
  }
  return rows;
}

/** From the first scored epoch to the end of the last: lights off to lights on. */
export function scoredSpan(labels: number[][]): Span | null {
  const scored = labels.filter(([, label]) => label !== undefined && label in LABELS);
  const first = scored[0]?.[0];
  const last = scored[scored.length - 1]?.[0];
  if (first === undefined || last === undefined) {
    return null;
  }
  return { start: T0 + first * 1000, end: T0 + last * 1000 + EPOCH_MS };
}

function truth(labels: number[][], window: Span): (Stage | null)[] {
  const count = Math.floor((window.end - window.start) / EPOCH_MS);
  const out = new Array<Stage | null>(count).fill(null);
  for (const [sec = 0, label = -1] of labels) {
    const i = Math.round((T0 + sec * 1000 - window.start) / EPOCH_MS);
    if (i >= 0 && i < count) {
      out[i] = LABELS[label] ?? null;
    }
  }
  return out;
}

/** Mean acceleration per second inside the window: the gravity vector at 1 Hz. */
export function gravity(rows: number[][], window: Span): Accel[] {
  const sums = new Map<number, number[]>();
  for (const [sec = 0, x = 0, y = 0, z = 0] of rows) {
    const ts = T0 + Math.floor(sec) * 1000;
    if (ts >= window.start && ts < window.end) {
      const s = sums.get(ts) ?? [0, 0, 0, 0];
      sums.set(ts, [(s[0] ?? 0) + x, (s[1] ?? 0) + y, (s[2] ?? 0) + z, (s[3] ?? 0) + 1]);
    }
  }
  return [...sums.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([ts, [x = 0, y = 0, z = 0, n = 1]]) => ({ ts, x: x / n, y: y / n, z: z / n }));
}

/** HR at each whole second of the window, linear between samples up to MAX_HR_GAP_S apart. */
export function heartRateAt1Hz(rows: number[][], window: Span): HeartRate[] {
  const samples = rows
    .map(([sec = 0, bpm = 0]) => ({ ts: T0 + sec * 1000, bpm }))
    .filter((s) => s.bpm > 0)
    .sort((a, b) => a.ts - b.ts);
  const out: HeartRate[] = [];
  let j = 0;
  for (let ts = window.start; ts < window.end; ts += 1000) {
    while (j + 1 < samples.length && (samples[j + 1]?.ts ?? 0) <= ts) {
      j++;
    }
    const bpm = between(samples[j], samples[j + 1], ts);
    if (bpm !== null) {
      out.push({ ts, bpm });
    }
  }
  return out;
}

function between(a: HeartRate | undefined, b: HeartRate | undefined, ts: number): number | null {
  if (a?.ts === ts) {
    return a.bpm;
  }
  if (!(a && b) || a.ts > ts || b.ts < ts || b.ts - a.ts > MAX_HR_GAP_S * 1000) {
    return null;
  }
  return a.bpm + ((b.bpm - a.bpm) * (ts - a.ts)) / (b.ts - a.ts);
}
