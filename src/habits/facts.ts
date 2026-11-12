// A day's facts and the one rule auto habits use (docs/habits.md#auto-ticks): `auto <fact> <op>
// <value>` compares a single named value for the day, so a new source is a new fact here, not a
// resolver per habit. factsFrom is pure; FactReader gathers its inputs from the vault and the
// derived tables, cached per day by the files' mtimes.

import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { DerivedRow, DerivedStore } from "../health/derived-store";
import { type Note, sectionLines } from "../vault/markdown";
import type { Vault } from "../vault/vault";
import { datesBetween } from "./habit-day";
import type { Habit } from "./habit-note";
import type { DayMark } from "./streaks";

export type FactKind = "count" | "number" | "minutes" | "kcal" | "time" | "rating";
export type Op = ">=" | "<=";

export interface FactDef {
  label: string;
  kind: FactKind;
  /** A night fact counts for the evening the night started, read from the next day's data. */
  night: boolean;
  /** What a bare `auto <fact>` means. Times are minutes after noon. */
  rule: { op: Op; value: number };
}

/** Each fact by its name in a rule. Order is the page's "Ticks itself from" menu. */
export const FACTS = {
  steps: { label: "Steps", kind: "count", night: false, rule: { op: ">=", value: 8000 } },
  active_kcal: {
    label: "Active calories",
    kind: "kcal",
    night: false,
    rule: { op: ">=", value: 500 },
  },
  strain: { label: "Strain", kind: "number", night: false, rule: { op: ">=", value: 12 } },
  zone2_min: {
    label: "Minutes in zone 2+",
    kind: "minutes",
    night: false,
    rule: { op: ">=", value: 30 },
  },
  workouts: { label: "Any workout", kind: "count", night: false, rule: { op: ">=", value: 1 } },
  lifting: { label: "Lifting", kind: "count", night: false, rule: { op: ">=", value: 1 } },
  running: { label: "Running", kind: "count", night: false, rule: { op: ">=", value: 1 } },
  volleyball: { label: "Volleyball", kind: "count", night: false, rule: { op: ">=", value: 1 } },
  walking: { label: "Walking", kind: "count", night: false, rule: { op: ">=", value: 1 } },
  lights_out: { label: "Lights out", kind: "time", night: true, rule: { op: "<=", value: 690 } },
  asleep_min: {
    label: "Time asleep",
    kind: "minutes",
    night: true,
    rule: { op: ">=", value: 420 },
  },
  journal: { label: "Journal entries", kind: "count", night: false, rule: { op: ">=", value: 1 } },
  feel: { label: "Morning check-in", kind: "rating", night: false, rule: { op: ">=", value: 1 } },
} satisfies Record<string, FactDef>;

export type FactName = keyof typeof FACTS;
export type DayFacts = Partial<Record<FactName, number>>;

export interface Rule {
  fact: FactName;
  op: Op;
  value: number;
}

export interface FactInputs {
  note: Note | null;
  /** The next day's note, for the night that started this evening. */
  nextNote: Note | null;
  day: DerivedRow | null;
  nextNight: DerivedRow | null;
  workouts: DerivedRow[];
}

const RULE = /^([a-z0-9_]+)(?:\s*(≥|≤|>=|<=)\s*(\S+))?$/;
const TIME = /^([01]?\d|2[0-3]):([0-5]\d)$/;
const WORKOUT_KINDS = ["lifting", "running", "volleyball", "walking"] as const;
/** Unsure workouts (`Lifting?`) wait for a review; dismissed ones never count. */
const COUNTED_STATUSES = new Set(["confirmed", "detected"]);
const MINUTES_PER_DAY = 1440;
const NOON = 720;

export function isFactName(name: string): name is FactName {
  return Object.hasOwn(FACTS, name);
}

/** "steps ≥ 8000", "lights_out <= 23:30", or a bare fact; null when it isn't a rule. */
export function parseRule(text: string): Rule | null {
  const match = RULE.exec(text.trim());
  const fact = match?.[1] ?? "";
  if (!(match && isFactName(fact))) {
    return null;
  }
  const def: FactDef = FACTS[fact];
  if (match[2] === undefined) {
    return { fact, ...def.rule };
  }
  const value = parseValue(def.kind, match[3] ?? "");
  const op = match[2] === "≥" || match[2] === ">=" ? ">=" : "<=";
  return value === null ? null : { fact, op, value };
}

function parseValue(kind: FactKind, text: string): number | null {
  if (kind === "time") {
    const time = TIME.exec(text);
    return time ? afterNoon(Number(time[1]) * 60 + Number(time[2])) : null;
  }
  const value = Number(text.replace(/,/g, ""));
  return Number.isFinite(value) ? value : null;
}

/** Minutes after noon, so 00:20 (720 + 20) is later than 23:30 (690). */
export function afterNoon(minutesOfDay: number): number {
  return (minutesOfDay + NOON) % MINUTES_PER_DAY;
}

/** How a day went for `rule`: done when its fact passes, pending while it may still arrive. */
export function autoMark(rule: Rule, facts: DayFacts, date: string, today: string): DayMark {
  const value = facts[rule.fact];
  const passes = rule.op === ">=" ? (v: number) => v >= rule.value : (v: number) => v <= rule.value;
  if (value !== undefined && passes(value)) {
    return "done";
  }
  const def: FactDef = FACTS[rule.fact];
  const ready = def.night ? Temporal.PlainDate.from(date).add({ days: 1 }).toString() : date;
  return ready >= today ? "pending" : "open";
}

/**
 * A HabitStore.stats callback over facts already read: each habit with a rule is marked from
 * them, and the rest (or a rule that doesn't parse) fall back to hand ticks.
 */
export function autoMarker(
  facts: Map<string, DayFacts>,
  today: string,
): (habit: Habit, date: string) => DayMark | null {
  const rules = new Map<string, Rule | null>();
  return (habit, date) => {
    if (!habit.auto) {
      return null;
    }
    if (!rules.has(habit.id)) {
      rules.set(habit.id, parseRule(habit.auto));
    }
    const rule = rules.get(habit.id);
    return rule ? autoMark(rule, facts.get(date) ?? {}, date, today) : null;
  };
}

/** The day's facts. A fact with no data is left out, never zero, so it can stay pending. */
export function factsFrom(inputs: FactInputs, timeZone: string): DayFacts {
  const fm = inputs.note?.frontmatter ?? {};
  const facts: DayFacts = {
    steps: num(fm.steps),
    active_kcal: num(fm.active_kcal),
    strain: num(fm.strain),
    feel: num(fm.feel),
    zone2_min: zoneTwoUp(inputs.day),
    asleep_min: num(inputs.nextNote?.frontmatter.tst_min),
    lights_out: lightsOut(inputs.nextNight, timeZone),
    journal: journalEntries(inputs.note),
    ...workoutCounts(inputs.workouts),
  };
  return Object.fromEntries(Object.entries(facts).filter(([, v]) => v !== undefined));
}

function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function zoneTwoUp(day: DerivedRow | null): number | undefined {
  const zones = [2, 3, 4, 5].map((z) => num(day?.[`zone${z}_min`]));
  return zones.every((z) => z === undefined)
    ? undefined
    : zones.reduce((sum = 0, z = 0) => sum + z, 0);
}

/** The start of the night's sleep window: lying down and still, not sleep onset. */
function lightsOut(night: DerivedRow | null, timeZone: string): number | undefined {
  const bed = num(night?.bed_ts);
  if (bed === undefined) {
    return undefined;
  }
  const time = Temporal.Instant.fromEpochMilliseconds(bed).toZonedDateTimeISO(timeZone);
  return afterNoon(time.hour * 60 + time.minute);
}

function journalEntries(note: Note | null): number | undefined {
  const lines = note ? sectionLines(note.body, "Journal") : null;
  return lines ? lines.filter((l) => /^- \d{2}:\d{2} /.test(l)).length : undefined;
}

function workoutCounts(rows: DerivedRow[]): DayFacts {
  if (rows.length === 0) {
    return {};
  }
  const counted = rows.filter((w) => COUNTED_STATUSES.has(String(w.status)));
  const counts: DayFacts = { workouts: counted.length };
  for (const kind of WORKOUT_KINDS) {
    counts[kind] = counted.filter((w) => w.kind === kind).length;
  }
  return counts;
}

/** Reads each day's facts, keeping them until one of the files they came from changes. */
export class FactReader {
  private cache = new Map<string, { key: string; facts: DayFacts }>();

  constructor(
    private readonly vault: Vault,
    private readonly derived: DerivedStore,
  ) {}

  async facts(date: string): Promise<DayFacts> {
    const next = Temporal.PlainDate.from(date).add({ days: 1 }).toString();
    const key = (await Promise.all(this.sourcesOf(date, next).map(mtimeOf))).join(",");
    const cached = this.cache.get(date);
    if (cached?.key === key) {
      return cached.facts;
    }
    const [note, nextNote, day, nextNight, workouts] = await Promise.all([
      this.vault.readDaily(date),
      this.vault.readDaily(next),
      this.derived.read("days", date),
      this.derived.read("nights", next),
      this.derived.readAll("workouts", date),
    ]);
    const facts = factsFrom({ note, nextNote, day, nextNight, workouts }, this.vault.timeZone);
    this.cache.set(date, { key, facts });
    return facts;
  }

  async range(from: string, to: string): Promise<Map<string, DayFacts>> {
    const dates = datesBetween(from, to);
    const all = await Promise.all(dates.map((date) => this.facts(date)));
    return new Map(dates.map((date, i) => [date, all[i] ?? {}]));
  }

  private sourcesOf(date: string, next: string): string[] {
    return [
      join(this.vault.root, this.vault.dailyPath(date)),
      join(this.vault.root, this.vault.dailyPath(next)),
      this.derived.path("days", date),
      this.derived.path("nights", next),
      this.derived.path("workouts", date),
    ];
  }
}

async function mtimeOf(path: string): Promise<number> {
  try {
    return (await stat(path)).mtimeMs;
  } catch {
    return 0;
  }
}
