// Computes one local day's health summary from the raw strap streams and writes it out: the
// computed tables in health-derived/, then the numbers and a Health block in the daily note.
//
// A date's summary covers the night that ended that morning (searched from 6 pm the evening
// before to 2 pm) and the activity of the calendar day itself, midnight to midnight.

import { localDate, localTime } from "../vault/time";
import type { Vault } from "../vault/vault";
import type { DerivedRow, DerivedStore } from "./derived-store";
import {
  BASELINE_NIGHTS,
  MIN_BASELINE_NIGHTS,
  type NightSignals,
  recovery,
  tempDeviation,
} from "./metrics/recovery";
import { DEFAULT_NEED_MIN, type PastNight } from "./metrics/sleep-score";
import { median } from "./metrics/stats";
import { dayMetrics, type NightMetrics, nightMetrics } from "./metrics/summary";
import type { Accel, HeartRate, RrInterval, SkinTemp, StepCounter } from "./metrics/types";
import { ParamsStore } from "./params";
import { parseProfile } from "./profile";
import type { RawStore, Row } from "./raw-store";
import { type DaySummary, frontmatter, healthBlock, syncLine } from "./render";

/** Bump when a calculation changes, so old rows can be told apart and rebuilt. */
export const ALGO_VERSION = "1";

export class DailySummary {
  private readonly params: ParamsStore;

  constructor(
    private readonly raw: RawStore,
    private readonly derived: DerivedStore,
    private readonly vault: Vault,
    private readonly timeZone: string,
    private readonly now: () => number = Date.now,
  ) {
    this.params = new ParamsStore(derived.root);
  }

  /**
   * Compute and write `date`. Resolves to the summary, or null when there was no data; today's
   * note still gets a Health block then, saying when data last arrived.
   */
  async run(date: string): Promise<DaySummary | null> {
    const summary = await this.compute(date);
    const synced = await this.synced(date);
    if (!summary.night && summary.day.wornMin === 0) {
      if (synced) {
        await this.vault.setDailyBlock(date, "health", healthBlock(null, 0, this.clock, synced));
      }
      return null;
    }
    await this.save(date, summary, synced);
    return summary;
  }

  async compute(date: string): Promise<DaySummary> {
    const params = await this.params.load();
    const profileFields = await this.vault.readProfile();
    const rows = await this.history(date);
    const history = rows.map(fromNightRow);
    const night = await this.night(date, rows, needMinutes(profileFields));
    const signals = night ? toSignals(night) : null;
    const day = dayMetrics({
      heartRate: await this.load(date, "heart_rate", 0, 24, toHeartRate),
      steps: await this.load(date, "steps", 0, 24, toSteps),
      restingHr: night?.restingHr ?? median(recentRestingHrs(history)),
      profile: parseProfile(profileFields, date),
    });
    return {
      night,
      day,
      recovery: signals ? recovery(signals, history, params.recovery) : null,
      paramsVersion: params.version,
      baselineNights: history.filter((n) => n.lnRmssd !== null).length,
      tempDevC: tempDeviation(signals?.skinTemp ?? null, history),
    };
  }

  private async night(
    date: string,
    history: DerivedRow[],
    needMin: number,
  ): Promise<NightMetrics | null> {
    const minutesAfterNoon = (ts: number) => afterNoon(ts, this.timeZone);
    return nightMetrics({
      accel: await this.load(date, "accel", -6, 14, toAccel),
      heartRate: await this.load(date, "heart_rate", -6, 14, toHeartRate),
      rr: await this.load(date, "rr_interval", -6, 14, toRr),
      skinTemp: await this.load(date, "temperature", -6, 14, toSkinTemp),
      past: history.map((row) => toPastNight(row, minutesAfterNoon)).filter((n) => n !== null),
      needMin,
      minutesAfterNoon,
    });
  }

  /** Earlier nights from the stored nights table, oldest first. */
  private async history(date: string): Promise<DerivedRow[]> {
    const day = Temporal.PlainDate.from(date);
    const rows: DerivedRow[] = [];
    for (let back = BASELINE_NIGHTS; back >= 1; back--) {
      const row = await this.derived.read("nights", day.subtract({ days: back }).toString());
      if (row) {
        rows.push(row);
      }
    }
    return rows;
  }

  /** A stream's rows from `fromHour` to `toHour` local time on `date` (negative = day before). */
  private async load<T>(
    date: string,
    stream: string,
    fromHour: number,
    toHour: number,
    convert: (row: Row) => T | null,
  ): Promise<T[]> {
    const midnight = Temporal.PlainDate.from(date).toZonedDateTime(this.timeZone);
    const from = midnight.add({ hours: fromHour }).epochMilliseconds;
    const to = Math.min(this.now(), midnight.add({ hours: toHour }).epochMilliseconds);
    const rows = await this.raw.readRange(stream, from, to);
    return rows.map(convert).filter((v): v is T => v !== null);
  }

  /** The Synced line for today's note; null on other days and before the first upload. */
  private async synced(date: string): Promise<string | null> {
    const now = this.now();
    const sync =
      date === localDate(new Date(now), this.timeZone) ? await this.raw.readSync() : null;
    if (!sync) {
      return null;
    }
    const when = (ts: number) =>
      localDate(new Date(ts), this.timeZone) === date
        ? this.clock(ts)
        : `${shortDayMonth(ts, this.timeZone)} ${this.clock(ts)}`;
    return syncLine(sync, now, when);
  }

  private readonly clock = (ts: number) => localTime(new Date(ts), this.timeZone);

  private async save(date: string, summary: DaySummary, synced: string | null): Promise<void> {
    const stamp = {
      date,
      algo_version: ALGO_VERSION,
      params_version: summary.paramsVersion,
      computed_at: new Date(this.now()).toISOString(),
    };
    if (summary.night) {
      await this.derived.write("nights", date, { ...stamp, ...nightRow(summary.night) });
    }
    await this.derived.write("days", date, { ...stamp, ...dayRow(summary) });
    await this.vault.recordHealth(date, frontmatter(summary), "strap");
    await this.vault.setDailyBlock(
      date,
      "health",
      healthBlock(summary, MIN_BASELINE_NIGHTS, this.clock, synced),
    );
  }
}

/** "3 Nov" in `timeZone`. */
function shortDayMonth(ts: number, timeZone: string): string {
  return new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" }).format(ts);
}

function toSignals(night: NightMetrics): NightSignals {
  return {
    lnRmssd: night.lnRmssd,
    restingHr: night.restingHr,
    breathingRate: night.breathingRate,
    skinTemp: night.skinTemp,
    sleepScore: night.sleep.score,
  };
}

/** Base sleep need from profile.md (sleep_need_h), or the default. */
function needMinutes(profile: Record<string, unknown> | null): number {
  const hours = profile?.sleep_need_h;
  return typeof hours === "number" && hours > 0 ? hours * 60 : DEFAULT_NEED_MIN;
}

/** Local clock time as minutes after noon, so a night's times never wrap at midnight. */
function afterNoon(ts: number, timeZone: string): number {
  const time = Temporal.Instant.fromEpochMilliseconds(ts).toZonedDateTimeISO(timeZone);
  return (time.hour * 60 + time.minute + 720) % 1440;
}

function toPastNight(row: DerivedRow, minutesAfterNoon: (ts: number) => number): PastNight | null {
  const { onset_ts: onset, wake_ts: wake, tst_min: asleep } = row;
  if (typeof onset !== "number" || typeof wake !== "number" || typeof asleep !== "number") {
    return null;
  }
  return { onsetMin: minutesAfterNoon(onset), wakeMin: minutesAfterNoon(wake), asleepMin: asleep };
}

function recentRestingHrs(history: NightSignals[]): number[] {
  return history
    .slice(-7)
    .map((n) => n.restingHr)
    .filter((v): v is number => v !== null);
}

function nightRow(night: NightMetrics): DerivedRow {
  return {
    bed_ts: night.bed,
    onset_ts: night.onset,
    wake_ts: night.wake,
    time_in_bed_min: night.inBedMin,
    tst_min: night.asleepMin,
    latency_min: night.latencyMin,
    waso_min: night.wakeAfterOnsetMin,
    awakenings: night.awakenings,
    efficiency_pct: night.efficiency * 100,
    sleep_score: night.sleep.score,
    sleep_need_min: night.sleep.needMin,
    sleep_performance_pct: night.sleep.sufficiency,
    sleep_consistency: night.sleep.consistency,
    rhr_bpm: night.restingHr,
    rmssd_ms: night.rmssdMs,
    ln_rmssd: night.lnRmssd,
    hrv_windows: night.hrvWindows,
    resp_rate_bpm: night.breathingRate,
    skin_temp_c: night.skinTemp,
  };
}

export function fromNightRow(row: DerivedRow): NightSignals {
  const num = (key: string) => (typeof row[key] === "number" ? (row[key] as number) : null);
  return {
    lnRmssd: num("ln_rmssd"),
    restingHr: num("rhr_bpm"),
    breathingRate: num("resp_rate_bpm"),
    skinTemp: num("skin_temp_c"),
    sleepScore: num("sleep_score"),
  };
}

function dayRow(s: DaySummary): DerivedRow {
  const zones = s.day.zoneMin ?? [];
  return {
    recovery_pct: s.recovery?.pct ?? null,
    recovery_score: s.recovery?.score ?? null,
    strain: s.day.strain,
    trimp: s.day.trimp,
    worn_min: s.day.wornMin,
    avg_hr: s.day.avgHr,
    max_hr: s.day.maxHr,
    steps: s.day.steps,
    temp_dev_c: s.tempDevC,
    ...Object.fromEntries([0, 1, 2, 3, 4].map((i) => [`zone${i + 1}_min`, zones[i] ?? null])),
  };
}

// ---- raw rows to typed samples (rows with a missing or non-numeric value are skipped) ----

function nums(row: Row, keys: string[]): number[] | null {
  const values = keys.map((k) => row[k]);
  return values.every((v) => typeof v === "number") ? (values as number[]) : null;
}

function toHeartRate(row: Row): HeartRate | null {
  const v = nums(row, ["bpm"]);
  return v ? { ts: row.ts, bpm: v[0] ?? 0 } : null;
}

function toRr(row: Row): RrInterval | null {
  const v = nums(row, ["ms"]);
  return v ? { ts: row.ts, ms: v[0] ?? 0 } : null;
}

function toAccel(row: Row): Accel | null {
  const v = nums(row, ["x", "y", "z"]);
  return v ? { ts: row.ts, x: v[0] ?? 0, y: v[1] ?? 0, z: v[2] ?? 0 } : null;
}

function toSkinTemp(row: Row): SkinTemp | null {
  const v = nums(row, ["celsius"]);
  return v ? { ts: row.ts, celsius: v[0] ?? 0 } : null;
}

function toSteps(row: Row): StepCounter | null {
  const v = nums(row, ["count"]);
  return v ? { ts: row.ts, count: v[0] ?? 0 } : null;
}
