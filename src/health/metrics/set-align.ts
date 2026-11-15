// Lining logged sets up with HR climbs by the log's structure, not by size. Climbs come from sets
// but also from walking to a machine or setting up, so there are usually more climbs than sets.
// Each set takes one climb, in order, and climbs that don't fit are skipped: the alignment
// prefers big climbs, a steady rest within an exercise, and allows a longer gap where you change
// exercise. A poor fit matches nothing, since wrong per-set numbers are worse than none.
// See docs/health-metrics.md.

import type { SetClimb } from "./sets";
import { median } from "./stats";
import type { Span } from "./types";

/** What alignment needs to know about a logged set. */
export interface PlannedSet {
  exerciseIndex: number;
}

/** Climbs within this of the run's edge carry it on past the strap's session. */
const RUN_GAP_MS = 4 * 60_000;
/**
 * How far past the session a run of climbs is followed. The strap trims a session's start, where a
 * light warm-up set doesn't read as exercise, but its end holds; past it are walking out and
 * moving about (on 14 November, climbs went on to 15:32 after a session that ended at 15:10).
 */
const RUN_BEFORE_MS = 10 * 60_000;
const RUN_AFTER_MS = 2 * 60_000;
/** A change of exercise may take up to this many rests before it costs anything. */
const SWITCH_REST = 3;
/** Weights of the fit's parts: a climb's strength, keeping the rest steady, skipping a climb. */
const REST_WEIGHT = 1;
const SKIP_WEIGHT = 0.6;
/** Climbs skipped before the first set or after the last cost less: walking in and out. */
const EDGE_SKIP_WEIGHT = 0.15;
/** A fit scoring under this per set isn't trusted. */
const MIN_SCORE_PER_SET = 0.35;

/**
 * The session widened along any run of climbs that carries on past its edges, so a first set that
 * wasn't hard enough to count as the workout isn't lost. `near` is every climb around it.
 */
export function sessionRun(session: Span, near: SetClimb[]): SetClimb[] {
  const sorted = [...near].sort((a, b) => a.peak - b.peak);
  const inside = sorted.filter((c) => c.peak >= session.start && c.peak < session.end);
  let first = inside[0]?.peak ?? session.start;
  let last = inside[inside.length - 1]?.peak ?? session.end;
  for (const c of [...sorted].reverse()) {
    if (c.peak < first && first - c.peak <= RUN_GAP_MS && session.start - c.peak <= RUN_BEFORE_MS) {
      first = c.peak;
    }
  }
  for (const c of sorted) {
    if (c.peak > last && c.peak - last <= RUN_GAP_MS && c.peak - session.end <= RUN_AFTER_MS) {
      last = c.peak;
    }
  }
  return sorted.filter((c) => c.peak >= first && c.peak <= last);
}

/** Each set's climb, in order, or null when the climbs don't fit the log well enough. */
export function alignSets(candidates: SetClimb[], sets: PlannedSet[]): SetClimb[] | null {
  const fit = fitSets(candidates, sets);
  return fit && fit.scorePerSet >= MIN_SCORE_PER_SET ? fit.climbs : null;
}

/** The best alignment and how well it fits, per set; null when there are too few climbs. */
export function fitSets(
  candidates: SetClimb[],
  sets: PlannedSet[],
): { climbs: SetClimb[]; scorePerSet: number } | null {
  const climbs = [...candidates].sort((a, b) => a.peak - b.peak);
  if (sets.length === 0 || climbs.length < sets.length) {
    return null;
  }
  const best = new Fit(climbs, sets).solve();
  if (!best) {
    return null;
  }
  return {
    climbs: best.picks.map((j) => climbs[j] as SetClimb),
    scorePerSet: best.score / sets.length,
  };
}

interface Path {
  score: number;
  picks: number[];
}

class Fit {
  private readonly strength: number[];
  /** About how long a set and its rest take: the run's length over the sets. */
  private readonly rest: number;

  constructor(
    private readonly climbs: SetClimb[],
    private readonly sets: PlannedSet[],
  ) {
    const typical = median(climbs.map((c) => c.climb)) ?? 1;
    this.strength = climbs.map((c) => Math.min(c.climb / typical, 2));
    const first = climbs[0]?.peak ?? 0;
    const last = climbs[climbs.length - 1]?.peak ?? 0;
    this.rest = Math.max((last - first) / Math.max(sets.length - 1, 1), 60_000);
  }

  /** Dynamic programming over (set, climb): the best path ending with set i on climb j. */
  solve(): Path | null {
    const n = this.sets.length;
    const m = this.climbs.length;
    let row: (Path | null)[] = this.climbs.map((_, j) =>
      j <= m - n ? { score: (this.strength[j] ?? 0) - this.skipped(0, j, true), picks: [j] } : null,
    );
    for (let i = 1; i < n; i++) {
      row = this.climbs.map((_, j) => (j >= i && j <= m - n + i ? this.extend(row, i, j) : null));
    }
    return this.finish(row);
  }

  private extend(previous: (Path | null)[], i: number, j: number): Path | null {
    let best: Path | null = null;
    for (let k = i - 1; k < j; k++) {
      const from = previous[k];
      if (!from) {
        continue;
      }
      const score =
        from.score +
        (this.strength[j] ?? 0) -
        this.restCost(i, k, j) -
        this.skipped(k + 1, j, false);
      if (!best || score > best.score) {
        best = { score, picks: [...from.picks, j] };
      }
    }
    return best;
  }

  private finish(row: (Path | null)[]): Path | null {
    let best: Path | null = null;
    row.forEach((path, j) => {
      if (path) {
        const score = path.score - this.skipped(j + 1, this.climbs.length, true);
        if (!best || score > best.score) {
          best = { score, picks: path.picks };
        }
      }
    });
    return best;
  }

  /** Set i on climb j after set i-1 on climb k: a steady rest, or a longer one to change exercise. */
  private restCost(i: number, k: number, j: number): number {
    const gap = (this.climbs[j]?.peak ?? 0) - (this.climbs[k]?.peak ?? 0);
    const ratio = gap / this.rest;
    const switching = this.sets[i]?.exerciseIndex !== this.sets[i - 1]?.exerciseIndex;
    if (!switching) {
      return REST_WEIGHT * Math.abs(Math.log(ratio));
    }
    if (ratio < 1) {
      return REST_WEIGHT * Math.log(1 / ratio);
    }
    return REST_WEIGHT * Math.max(0, Math.log(ratio / SWITCH_REST));
  }

  /** Climbs from..to-1 left out; cheaper at the edges. */
  private skipped(from: number, to: number, edge: boolean): number {
    let total = 0;
    for (let j = from; j < to; j++) {
      total += this.strength[j] ?? 0;
    }
    return total * (edge ? EDGE_SKIP_WEIGHT : SKIP_WEIGHT);
  }
}
