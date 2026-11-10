// Breathing rate from heartbeats (respiratory sinus arrhythmia).
//
// Breathing in briefly releases the vagal brake, so the heart speeds up; breathing out slows it.
// The beat gaps therefore rise and fall once per breath. We find that rhythm's frequency with a
// Fourier transform, following Natarajan et al. 2021 (Fitbit). See docs/health-metrics.md.

import type { CleanBeat } from "./hrv";
import { median } from "./stats";

/** Resample the uneven beat series at 4 Hz so it can be transformed. */
export const SAMPLE_HZ = 4;
/** 6 to 30 breaths a minute. */
const MIN_HZ = 0.1;
const MAX_HZ = 0.5;
/** A peak must stand 2.5× above the band's typical power to count. */
const MIN_SNR = 2.5;
/** 4.5 minutes of a 5-minute window: a resolution of 1/270 Hz, about 0.2 breaths a minute. */
const SPECTRUM_SAMPLES = SAMPLE_HZ * 270;

export interface SpectrumBin {
  hz: number;
  power: number;
}

/** Evenly sampled gap values (ms) over the window, linearly interpolated between kept beats. */
export function resample(window: CleanBeat[]): number[] {
  const kept = window.filter((b) => b.kept);
  const first = kept[0];
  const last = kept[kept.length - 1];
  if (!(first && last) || kept.length < 2) {
    return [];
  }
  const step = 1000 / SAMPLE_HZ;
  const samples: number[] = [];
  let k = 0;
  for (let t = first.ts; t <= last.ts; t += step) {
    while ((kept[k + 1]?.ts ?? Number.POSITIVE_INFINITY) < t) {
      k++;
    }
    samples.push(interpolate(kept[k], kept[k + 1], t));
  }
  return samples;
}

function interpolate(a: CleanBeat | undefined, b: CleanBeat | undefined, t: number): number {
  if (!a) {
    return 0;
  }
  if (!b || b.ts === a.ts) {
    return a.ms;
  }
  return a.ms + ((b.ms - a.ms) * (t - a.ts)) / (b.ts - a.ts);
}

/** Remove the straight-line trend (slow heart-rate drift), so only the wobble is left. */
export function detrend(values: number[]): number[] {
  const n = values.length;
  const xMean = (n - 1) / 2;
  const yMean = values.reduce((s, v) => s + v, 0) / n;
  let num = 0;
  let den = 0;
  for (const [i, v] of values.entries()) {
    num += (i - xMean) * (v - yMean);
    den += (i - xMean) ** 2;
  }
  const slope = den === 0 ? 0 : num / den;
  return values.map((v, i) => v - yMean - slope * (i - xMean));
}

/**
 * Power at each frequency in the breathing band, from a Hann-windowed discrete Fourier
 * transform. Frequencies step by 1/duration, the finest a window this long can resolve.
 */
export function bandSpectrum(values: number[]): SpectrumBin[] {
  const n = values.length;
  const basis = bandBasis(n);
  const tapered = values.map((v, i) => v * (basis.taper[i] ?? 0));
  return basis.bins.map(({ hz, cos, sin }) => {
    let re = 0;
    let im = 0;
    for (let i = 0; i < n; i++) {
      const v = tapered[i] ?? 0;
      re += v * (cos[i] ?? 0);
      im -= v * (sin[i] ?? 0);
    }
    return { hz, power: re * re + im * im };
  });
}

interface BandBasis {
  taper: Float64Array;
  bins: { hz: number; cos: Float64Array; sin: Float64Array }[];
}

/**
 * The Hann taper and each band frequency's cosines and sines for n samples. Windows share a
 * length, so these are worked out once: sleep-features.ts transforms a window per epoch.
 */
const bases = new Map<number, BandBasis>();

function bandBasis(n: number): BandBasis {
  const cached = bases.get(n);
  if (cached) {
    return cached;
  }
  const taper = Float64Array.from(
    { length: n },
    (_, i) => 0.5 - 0.5 * Math.cos((2 * Math.PI * i) / (n - 1)),
  );
  const stepHz = SAMPLE_HZ / n;
  const bins: BandBasis["bins"] = [];
  for (let k = Math.ceil(MIN_HZ / stepHz); k * stepHz <= MAX_HZ; k++) {
    const angle = (i: number) => (2 * Math.PI * k * i) / n;
    bins.push({
      hz: k * stepHz,
      cos: Float64Array.from({ length: n }, (_, i) => Math.cos(angle(i))),
      sin: Float64Array.from({ length: n }, (_, i) => Math.sin(angle(i))),
    });
  }
  const basis = { taper, bins };
  bases.set(n, basis);
  return basis;
}

/**
 * Breaths per minute for the night: average the windows' spectra (each scaled to sum to 1, so a
 * noisy window can't dominate), take the tallest peak, and keep it only if it stands out.
 */
export function breathingRate(windows: CleanBeat[][]): number | null {
  const total = new Map<number, number>();
  for (const window of windows) {
    addSpectrum(total, window);
  }
  const peak = sharpestPeak([...total.entries()].map(([hz, power]) => ({ hz, power })));
  if (peak === null || peak.ratio < MIN_SNR) {
    return null;
  }
  return peak.hz * 60;
}

/** The tallest bin, and how many times the band's median power it is. */
export function sharpestPeak(spectrum: SpectrumBin[]): { hz: number; ratio: number } | null {
  const peak = spectrum.reduce<SpectrumBin | null>(
    (best, bin) => (best === null || bin.power > best.power ? bin : best),
    null,
  );
  const typical = median(spectrum.map((bin) => bin.power));
  if (peak === null || typical === null) {
    return null;
  }
  return { hz: peak.hz, ratio: peak.power / typical };
}

/**
 * The band spectrum of a window's first `length` samples. Every window is cut to the same length
 * so their frequency bins line up. Null when the window is shorter.
 */
export function windowSpectrum(window: CleanBeat[], length: number): SpectrumBin[] | null {
  const samples = resample(window);
  if (samples.length < length) {
    return null;
  }
  return bandSpectrum(detrend(samples.slice(0, length)));
}

function addSpectrum(total: Map<number, number>, window: CleanBeat[]): void {
  const spectrum = windowSpectrum(window, SPECTRUM_SAMPLES);
  if (spectrum === null) {
    return;
  }
  const sum = spectrum.reduce((s, bin) => s + bin.power, 0);
  if (sum <= 0) {
    return;
  }
  for (const bin of spectrum) {
    const key = Math.round(bin.hz * 10_000) / 10_000;
    total.set(key, (total.get(key) ?? 0) + bin.power / sum);
  }
}
