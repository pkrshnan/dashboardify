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

/** Ranks from 1, with tied values sharing the average of their ranks. */
export function ranks(values: number[]): number[] {
  const order = values.map((v, i) => ({ v, i })).sort((a, b) => a.v - b.v);
  const result = new Array<number>(values.length).fill(0);
  let start = 0;
  while (start < order.length) {
    let end = start;
    while (end + 1 < order.length && order[end + 1]?.v === order[start]?.v) {
      end++;
    }
    for (let k = start; k <= end; k++) {
      result[order[k]?.i ?? 0] = (start + end) / 2 + 1;
    }
    start = end + 1;
  }
  return result;
}

/** Pearson correlation of two equal-length lists. Null when either doesn't vary. */
export function correlation(xs: number[], ys: number[]): number | null {
  const mx = mean(xs);
  const my = mean(ys);
  if (mx === null || my === null || xs.length !== ys.length || xs.length < 3) {
    return null;
  }
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  xs.forEach((x, i) => {
    const y = ys[i] ?? my;
    sxy += (x - mx) * (y - my);
    sxx += (x - mx) ** 2;
    syy += (y - my) ** 2;
  });
  return sxx === 0 || syy === 0 ? null : sxy / Math.sqrt(sxx * syy);
}

/**
 * Spearman rank correlation: do higher xs go with higher ys, whatever the shape? Used to ask
 * whether recovery agrees with how you felt, since a 1–5 rating has no meaningful spacing.
 */
export function rankCorrelation(xs: number[], ys: number[]): number | null {
  return correlation(ranks(xs), ranks(ys));
}

/** Solve A·x = b by Gaussian elimination with partial pivoting. Null if A is singular. */
export function solveLinear(a: number[][], b: number[]): number[] | null {
  const n = b.length;
  const m = a.map((row, i) => [...row, b[i] ?? 0]);
  for (let col = 0; col < n; col++) {
    const pivot = pivotRow(m, col);
    const pivotRowValues = m[pivot];
    if (!pivotRowValues || Math.abs(pivotRowValues[col] ?? 0) < 1e-12) {
      return null;
    }
    [m[col], m[pivot]] = [pivotRowValues, m[col] ?? pivotRowValues];
    eliminate(m, col);
  }
  return m.map((row, i) => (row[n] ?? 0) / (row[i] ?? 1));
}

function pivotRow(m: number[][], col: number): number {
  let best = col;
  for (let r = col + 1; r < m.length; r++) {
    if (Math.abs(m[r]?.[col] ?? 0) > Math.abs(m[best]?.[col] ?? 0)) {
      best = r;
    }
  }
  return best;
}

/** Zero column `col` in every row except row `col`. */
function eliminate(m: number[][], col: number): void {
  const pivot = m[col] ?? [];
  m.forEach((row, r) => {
    if (r !== col) {
      subtractScaled(row, pivot, (row[col] ?? 0) / (pivot[col] ?? 1), col);
    }
  });
}

/** row -= factor × pivot, from column `from` on. */
function subtractScaled(row: number[], pivot: number[], factor: number, from: number): void {
  for (let k = from; k < row.length; k++) {
    row[k] = (row[k] ?? 0) - factor * (pivot[k] ?? 0);
  }
}
