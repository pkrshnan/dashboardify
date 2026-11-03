// Small statistics helpers shared by the metric calculations. Pure functions on plain arrays.

export function mean(values: number[]): number | null {
  if (values.length === 0) {
    return null;
  }
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

/** Sample standard deviation (n − 1). Null for fewer than two values. */
export function sd(values: number[]): number | null {
  const m = mean(values);
  if (m === null || values.length < 2) {
    return null;
  }
  const squares = values.reduce((sum, v) => sum + (v - m) ** 2, 0);
  return Math.sqrt(squares / (values.length - 1));
}

/** The p-th percentile (0–100), linearly interpolated between the closest ranks. */
export function percentile(values: number[], p: number): number | null {
  if (values.length === 0) {
    return null;
  }
  const sorted = [...values].sort((a, b) => a - b);
  const rank = (p / 100) * (sorted.length - 1);
  const low = Math.floor(rank);
  const high = Math.ceil(rank);
  const lowValue = sorted[low] ?? 0;
  const highValue = sorted[high] ?? lowValue;
  return lowValue + (highValue - lowValue) * (rank - low);
}

export function median(values: number[]): number | null {
  return percentile(values, 50);
}

/**
 * The standard normal cumulative distribution Φ(x): the share of a bell curve below x.
 * Abramowitz & Stegun 7.1.26, accurate to about 1e-7.
 */
export function normalCdf(x: number): number {
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const poly =
    t *
    (0.254829592 + t * (-0.284496736 + t * (1.421413741 + t * (-1.453152027 + t * 1.061405429))));
  const erf = 1 - poly * Math.exp(-z * z);
  return x >= 0 ? (1 + erf) / 2 : (1 - erf) / 2;
}

/** Group timestamped values into fixed buckets (e.g. minutes) by `Math.floor(ts / size)`. */
export function bucket<T extends { ts: number }>(items: T[], sizeMs: number): Map<number, T[]> {
  const buckets = new Map<number, T[]>();
  for (const item of items) {
    const key = Math.floor(item.ts / sizeMs);
    const list = buckets.get(key);
    if (list) {
      list.push(item);
    } else {
      buckets.set(key, [item]);
    }
  }
  return buckets;
}

export function round(value: number | null, digits: number): number | null {
  if (value === null) {
    return null;
  }
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
