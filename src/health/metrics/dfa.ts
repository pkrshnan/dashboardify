// Short-term detrended fluctuation analysis of RR intervals: DFA α1 (H13).
//
// α1 says how correlated the gaps are from beat to beat over 4–16 beats: about 0.5 for
// uncorrelated noise, about 1.0 for 1/f-like fluctuations, 1.5 for a random walk. Peng 1995
// (Chaos 5:82) defined it and split the scales at 16 beats; the exercise-physiology α1 work uses
// the same 4–16 range (Gronwald 2020, Front Physiol 11:550572; Rogers 2021, Front Physiol
// 11:596567). In sleep the correlations are lost in deep sleep and strong in REM and wake (Bunde
// 2000, PRL 85:3736; Penzel 2003, IEEE TBME 50:1143). See docs/health-metrics.md.

/** Peng 1995's short-term range, every box size from 4 to 16 beats. */
const MIN_BOX = 4;
const MAX_BOX = 16;
/**
 * 100 beats gives at least 6 boxes at the largest size, so every F(n) averages several boxes.
 * It is also about the 2-minute window Rogers 2021 computes α1 over at a resting heart rate.
 */
export const MIN_DFA_BEATS = 100;

/** DFA α1 of consecutive RR intervals; null under MIN_DFA_BEATS or for a flat series. */
export function dfaAlpha1(intervals: number[]): number | null {
  if (intervals.length < MIN_DFA_BEATS) {
    return null;
  }
  const profile = integrate(intervals);
  const logN: number[] = [];
  const logF: number[] = [];
  for (let n = MIN_BOX; n <= MAX_BOX; n++) {
    const f = fluctuation(profile, n);
    if (f <= 0) {
      return null;
    }
    logN.push(Math.log(n));
    logF.push(Math.log(f));
  }
  return slope(logN, logF);
}

/** The running sum of each interval less the mean. */
function integrate(intervals: number[]): number[] {
  const m = intervals.reduce((sum, v) => sum + v, 0) / intervals.length;
  const profile: number[] = [];
  let total = 0;
  for (const v of intervals) {
    total += v - m;
    profile.push(total);
  }
  return profile;
}

/**
 * F(n): the RMS of the residuals from a least-squares line in each non-overlapping box of n,
 * from the start; the leftover tail shorter than a box is left out, as in Peng 1995.
 */
function fluctuation(profile: number[], n: number): number {
  const boxes = Math.floor(profile.length / n);
  let squares = 0;
  for (let b = 0; b < boxes; b++) {
    squares += boxResiduals(profile, b * n, n);
  }
  return Math.sqrt(squares / (boxes * n));
}

/** The sum of squared residuals from the least-squares line through profile[from, from + n). */
function boxResiduals(profile: number[], from: number, n: number): number {
  // x runs 0…n−1, so its sums have closed forms.
  const sx = (n * (n - 1)) / 2;
  const sxx = ((n - 1) * n * (2 * n - 1)) / 6;
  let sy = 0;
  let sxy = 0;
  let syy = 0;
  for (let x = 0; x < n; x++) {
    const y = profile[from + x] ?? 0;
    sy += y;
    sxy += x * y;
    syy += y * y;
  }
  const cxx = sxx - (sx * sx) / n;
  const cxy = sxy - (sx * sy) / n;
  const cyy = syy - (sy * sy) / n;
  return Math.max(0, cyy - (cxy * cxy) / cxx);
}

/** The least-squares slope of y on x. */
function slope(x: number[], y: number[]): number {
  const mx = x.reduce((sum, v) => sum + v, 0) / x.length;
  const my = y.reduce((sum, v) => sum + v, 0) / y.length;
  let cxy = 0;
  let cxx = 0;
  x.forEach((xi, i) => {
    cxy += (xi - mx) * ((y[i] ?? 0) - my);
    cxx += (xi - mx) ** 2;
  });
  return cxy / cxx;
}
