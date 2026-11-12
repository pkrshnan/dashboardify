import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailySummary } from "../../src/health/daily-summary";
import { DerivedStore } from "../../src/health/derived-store";
import { RawStore, utcDays } from "../../src/health/raw-store";
import type { Sample } from "../../src/health/samples";
import { SummaryScheduler } from "../../src/health/scheduler";
import { editNote, parseNote } from "../../src/vault/markdown";
import { Vault } from "../../src/vault/vault";
import { writeReview } from "../../src/vault/workout-reviews";
import { accelDay, breathingBeats, HOUR, heartRate } from "./metrics/fixtures";

const TZ = "America/Los_Angeles";
const DATE = "2026-11-02";
// 6 pm the evening before DATE, Los Angeles time (UTC−7 until Nov 1, then UTC−8).
const EVENING = Date.parse("2026-11-01T18:00:00-08:00");
const SLEEP = { start: EVENING + 5 * HOUR, end: EVENING + 13 * HOUR }; // 23:00 to 07:00

let dir: string;
let raw: RawStore;
let derived: DerivedStore;
let vault: Vault;
let summary: DailySummary;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "summary-"));
  raw = new RawStore(join(dir, "health-raw"));
  derived = new DerivedStore(join(dir, "health-derived"));
  vault = new Vault(join(dir, "vault"), TZ);
  const now = () => Date.parse("2026-11-03T12:00:00-08:00");
  summary = new DailySummary(raw, derived, vault, TZ, now);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

/** Store rows the way an upload would: one file per UTC day. */
async function put(stream: string, header: string[], rows: Sample[]): Promise<void> {
  const first = rows[0]?.ts ?? 0;
  const last = rows[rows.length - 1]?.ts ?? 0;
  for (const day of utcDays(first, last + 1)) {
    const start = Date.parse(`${day}T00:00:00Z`);
    const samples = rows.filter((r) => r.ts >= start && r.ts < start + 86_400_000);
    if (samples.length > 0) {
      const result = await raw.store(stream, day, { header: ["ts", ...header], samples });
      expect(result.ok).toBe(true);
    }
  }
}

async function putNight(): Promise<void> {
  const to = EVENING + 30 * HOUR;
  await put(
    "accel",
    ["x", "y", "z"],
    accelDay(EVENING, to, SLEEP).map((a) => ({ ts: a.ts, values: [a.x, a.y, a.z] })),
  );
  const bpm = (ts: number) => (ts >= SLEEP.start && ts < SLEEP.end ? 52 : 110);
  await put(
    "heart_rate",
    ["bpm"],
    heartRate(EVENING, to, bpm).map((h) => ({ ts: h.ts, values: [h.bpm] })),
  );
  const beats = breathingBeats(SLEEP.start, SLEEP.end - SLEEP.start, { base: 1150 });
  await put(
    "rr_interval",
    ["ms"],
    beats.map((b) => ({ ts: b.ts, values: [b.ms] })),
  );
  await put("temperature", ["celsius"], [{ ts: SLEEP.start + HOUR, values: [34.5] }]);
}

/** A 40-minute run at 18:00, with a quiet half hour either side so it stands apart from the
 * fixture's all-day 110 bpm. */
async function putRun(): Promise<void> {
  const start = Date.parse(`${DATE}T17:30:00-08:00`);
  const seconds = Array.from({ length: 100 * 60 }, (_, i) => i);
  const running = (i: number) => i >= 30 * 60 && i < 70 * 60;
  const at = (i: number) => start + i * 1000;
  await put(
    "heart_rate",
    ["bpm"],
    seconds.map((i) => ({ ts: at(i), values: [running(i) ? 165 : 80] })),
  );
  // 165 steps a minute while running; the counter holds still otherwise.
  const count = (i: number) => Math.floor(2.75 * Math.min(Math.max(i - 30 * 60, 0), 40 * 60));
  await put(
    "steps",
    ["count"],
    seconds.map((i) => ({ ts: at(i), values: [count(i)] })),
  );
  await put(
    "motion",
    ["intensity", "intensity_long"],
    seconds.map((i) => ({ ts: at(i), values: [running(i) ? 0.5 : 0.03, -3] })),
  );
}

/** The night after DATE, 23:00 to 07:00, with data from 20:00 so it doesn't overlap putRun. */
async function putNextNight(): Promise<void> {
  const from = EVENING + 26 * HOUR;
  const to = EVENING + 44 * HOUR;
  const sleep = { start: SLEEP.start + 24 * HOUR, end: SLEEP.end + 24 * HOUR };
  await put(
    "accel",
    ["x", "y", "z"],
    accelDay(from, to, sleep).map((a) => ({ ts: a.ts, values: [a.x, a.y, a.z] })),
  );
  const bpm = (ts: number) => (ts >= sleep.start && ts < sleep.end ? 52 : 80);
  await put(
    "heart_rate",
    ["bpm"],
    heartRate(from, to, bpm).map((h) => ({ ts: h.ts, values: [h.bpm] })),
  );
}

async function writeProfile(body = ""): Promise<void> {
  await mkdir(join(dir, "vault"), { recursive: true });
  await writeFile(
    join(dir, "vault", "profile.md"),
    `---\nbirth_date: 1996-05-01\nsex: male\n${body}---\n`,
  );
}

describe("DailySummary", () => {
  test("no data writes nothing", async () => {
    expect(await summary.run(DATE)).toBeNull();
    expect(await vault.readDaily(DATE)).toBeNull();
  });

  test("writes the night and day to the daily note and the derived tables", async () => {
    await putNight();
    await writeProfile();
    const result = await summary.run(DATE);
    expect(result?.night?.restingHr).toBeCloseTo(52, 0);

    const note = await vault.readDaily(DATE);
    expect(note?.frontmatter).toMatchObject({ date: DATE, rhr_bpm: 52, tst_min: 480 });
    expect(note?.frontmatter.resp_rate_bpm).toBeCloseTo(15, 0);
    expect(note?.frontmatter.strain).toBeGreaterThan(0);
    expect(note?.frontmatter.recovery_pct).toBeUndefined();
    expect(note?.body).toContain("<!-- cc:health -->\n## Health\n\n- Recovery calibrating, 0/14");
    expect(note?.body).toContain("- Sleep **100** · 8h 00m of 8h 00m · 23:00–07:00");
    // The block sits above the journal, so journal lines never land inside it.
    expect(note?.body.indexOf("## Health")).toBeLessThan(note?.body.indexOf("## Journal") ?? 0);

    expect((await derived.read("nights", DATE))?.rhr_bpm).toBeCloseTo(52, 0);
    expect((await derived.read("days", DATE))?.algo_version).toBe("12");
    // No earlier days, so no training load yet.
    expect(note?.body).not.toContain("- Load");
    expect(note?.frontmatter.load_ratio).toBeUndefined();
    // No weight or height in the profile, so no calories.
    expect(note?.body).not.toContain("- Calories");
    expect(note?.frontmatter.kcal).toBeUndefined();
    expect((await derived.read("days", DATE))?.kcal).toBeNull();
  });

  test("sleep stages go in the nights row, stages/, the frontmatter and a line after Sleep", async () => {
    await putNight();
    await writeProfile();

    const result = await summary.run(DATE);

    const night = result?.night;
    const stages = night?.stages;
    if (!(night && stages)) {
      throw new Error("expected a staged night");
    }
    const { lightMin, deepMin, remMin, runs } = stages;
    // The fixture's HR is flat, so the stages rest on its near-constant beats: light-heavy.
    expect(stages.plausible).toBe(false);
    expect(lightMin + deepMin + remMin).toBe(night.asleepMin);
    const note = await vault.readDaily(DATE);
    const hm = (min: number) =>
      `${Math.floor(Math.round(min) / 60)}h ${String(Math.round(min) % 60).padStart(2, "0")}m`;
    const line = `- Deep ${hm(deepMin)} · REM ${hm(remMin)} · Light ${hm(lightMin)} · unusual`;
    expect(note?.body).toContain(
      `- Sleep **100** · 8h 00m of 8h 00m · 23:00–07:00\n${line}\n- RHR`,
    );
    expect(note?.frontmatter).toMatchObject({
      light_min: Math.round(lightMin),
      deep_min: Math.round(deepMin),
      rem_min: Math.round(remMin),
    });
    expect(await derived.read("nights", DATE)).toMatchObject({
      light_min: lightMin,
      deep_min: deepMin,
      rem_min: remMin,
      stages_plausible: 0,
    });
    const rows = await derived.readAll("stages", DATE);
    expect(rows).toHaveLength(runs.length);
    expect(rows[0]).toMatchObject({
      date: DATE,
      algo_version: "12",
      start_ts: runs[0]?.start,
      end_ts: runs[0]?.end,
      stage: runs[0]?.stage,
    });
    expect(rows.map((r) => r.stage)).toContain("deep");
  });

  test("no stages without a night, and none left from an earlier run", async () => {
    await putNight();
    await writeProfile();
    await summary.run(DATE);
    await rm(join(dir, "health-raw"), { recursive: true, force: true });
    raw = new RawStore(join(dir, "health-raw"));
    summary = new DailySummary(raw, derived, vault, TZ, () =>
      Date.parse("2026-11-03T12:00:00-08:00"),
    );
    await putNextNight();

    await summary.run(DATE);

    expect(await derived.readAll("stages", DATE)).toEqual([]);
    expect((await vault.readDaily(DATE))?.body).not.toContain("- Deep");
  });

  test("calories appear after the strain line with weight and height in the profile", async () => {
    await putNight();
    await writeProfile("weight_kg: 75\nheight_cm: 180\n");

    const result = await summary.run(DATE);

    const kcal = Math.round(result?.day.calories?.kcal ?? 0);
    const active = Math.round(result?.day.calories?.activeKcal ?? 0);
    // Above BMR (1,730 kcal for this profile at 30) for a whole day awake at 110 bpm.
    expect(kcal).toBeGreaterThan(1730);
    expect(active).toBe(kcal - 1730);
    const note = await vault.readDaily(DATE);
    expect(note?.frontmatter).toMatchObject({ kcal, active_kcal: active });
    expect(note?.body).toContain(
      `- Calories ${kcal.toLocaleString("en-US")} · ${active.toLocaleString("en-US")} active`,
    );
    expect(note?.body).toMatch(/- Strain \*\*[\d.]+\*\* · Zones [\d /]+ min\n- Calories/);
    expect(await derived.read("days", DATE)).toMatchObject({ kcal, active_kcal: active });
  });

  test("today's calories are a running total of the minutes so far", async () => {
    await putNight();
    await writeProfile("weight_kg: 75\nheight_cm: 180\n");
    const morning = new DailySummary(raw, derived, vault, TZ, () =>
      Date.parse(`${DATE}T06:00:00-08:00`),
    );

    const result = await morning.run(DATE);

    // Six hours, all asleep: BMR 1,730 × 0.95 for 360 of 1,440 minutes.
    expect(result?.day.calories?.kcal).toBeCloseTo((1730 * 0.95 * 360) / 1440, 6);
    expect(result?.day.calories?.activeKcal).toBe(0);
  });

  test("training load appears after the strain line once there are four weeks of days", async () => {
    await putNight();
    await writeProfile();
    for (let i = 1; i <= 28; i++) {
      const date = Temporal.PlainDate.from(DATE).subtract({ days: i }).toString();
      await derived.write("days", date, { trimp: 60, worn_min: 1440 });
    }

    const result = await summary.run(DATE);

    const ratio = result?.load.ratio ?? 0;
    expect(ratio).toBeGreaterThan(0);
    const note = await vault.readDaily(DATE);
    expect(note?.frontmatter.load_ratio).toBe(Math.round(ratio * 100) / 100);
    expect(note?.frontmatter.load_chronic).toBeGreaterThan(0);
    expect(note?.body).toMatch(
      /- Strain \*\*[\d.]+\*\* · Zones [\d /]+ min\n- Load [a-z ]+ · \d\.\d\d \(7 d vs 28 d\)/,
    );
    expect((await derived.read("days", DATE))?.load_ratio).toBeCloseTo(ratio, 6);
  });

  test("VO2max appears after the calories line with a measured max and two weeks of nights", async () => {
    await putNight();
    await writeProfile("weight_kg: 75\nheight_cm: 180\nhr_max_measured: 205\n");
    // 13 stored nights at 58, then last night's 52: median 58 of 14.
    for (let i = 1; i <= 13; i++) {
      const date = Temporal.PlainDate.from(DATE).subtract({ days: i }).toString();
      await derived.write("nights", date, { rhr_bpm: 58 });
    }

    const result = await summary.run(DATE);

    const expected = (15.3 * 205) / 58;
    expect(result?.vo2max).toBeCloseTo(expected, 6);
    const note = await vault.readDaily(DATE);
    expect(note?.frontmatter.vo2max).toBe(54);
    expect(note?.body).toMatch(/- Calories [\d,]+ · [\d,]+ active\n- VO2max 54 \(estimate\)\n/);
    expect((await derived.read("days", DATE))?.vo2max).toBe(Math.round(expected * 10) / 10);
  });

  test("no VO2max with too few nights or only a predicted max", async () => {
    await putNight();
    await writeProfile("hr_max_measured: 205\n");
    for (let i = 1; i <= 12; i++) {
      const date = Temporal.PlainDate.from(DATE).subtract({ days: i }).toString();
      await derived.write("nights", date, { rhr_bpm: 58 });
    }
    expect((await summary.run(DATE))?.vo2max).toBeNull();

    // A 14th night, but with no measured max HR in the profile.
    await derived.write("nights", "2026-10-19", { rhr_bpm: 58 });
    await writeProfile();

    expect((await summary.run(DATE))?.vo2max).toBeNull();
    const note = await vault.readDaily(DATE);
    expect(note?.body).not.toContain("- VO2max");
    expect(note?.frontmatter.vo2max).toBeUndefined();
    expect((await derived.read("days", DATE))?.vo2max).toBeNull();
  });

  test("recovery appears once there are two weeks of nights", async () => {
    await putNight();
    for (let i = 1; i <= 20; i++) {
      const date = Temporal.PlainDate.from(DATE).subtract({ days: i }).toString();
      await derived.write("nights", date, {
        ln_rmssd: Math.log(40) + (i % 3) * 0.05,
        rhr_bpm: 52 + (i % 4),
        resp_rate_bpm: 15,
        skin_temp_c: 34.4,
      });
    }
    const result = await summary.run(DATE);
    expect(result?.recovery?.pct).toBeGreaterThan(0);
    const note = await vault.readDaily(DATE);
    expect(note?.frontmatter.recovery_pct).toBe(Math.round(result?.recovery?.pct ?? -1));
    expect(note?.frontmatter.temp_dev_c).toBeCloseTo(0.1, 2);
  });

  test("a run becomes a workout line, a workouts row and the day's workout minutes", async () => {
    await putNight();
    await writeProfile();
    await putRun();

    await summary.run(DATE);

    const note = await vault.readDaily(DATE);
    expect(note?.body).toMatch(/- Running 18:00–18:40 · 40 min · 165 avg \/ 165 max · strain \d/);
    const rows = await derived.readAll("workouts", DATE);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ kind: "running", status: "detected", duration_min: 40 });
    // No weight or height in the profile, so no calories on the line or the row.
    expect(note?.body).not.toContain("kcal");
    expect(rows[0]?.kcal).toBeNull();
    expect((await derived.read("days", DATE))?.workout_min).toBe(40);
    // The run is fast stepping, but it is a workout, so it isn't also a walk.
    expect(await derived.readAll("walks", DATE)).toEqual([]);
  });

  test("a run's calories go on its line and its row", async () => {
    await putNight();
    await writeProfile("weight_kg: 75\nheight_cm: 180\n");
    await putRun();

    const result = await summary.run(DATE);

    const kcal = result?.day.workouts[0]?.kcal ?? 0;
    // 40 minutes at 165 bpm, full Keytel: about 15 kcal a minute for this profile.
    expect(kcal).toBeGreaterThan(400);
    expect(kcal).toBeLessThan(result?.day.calories?.activeKcal ?? 0);
    const note = await vault.readDaily(DATE);
    expect(note?.body).toMatch(
      new RegExp(`- Running 18:00–18:40 · .* · strain [\\d.]+ · ${Math.round(kcal)} kcal\n`),
    );
    expect((await derived.readAll("workouts", DATE))[0]?.kcal).toBe(Math.round(kcal));
  });

  test("a Strava run inside the strap's session takes its window, distance and pace", async () => {
    await putNight();
    await writeProfile();
    await putRun();
    const start = Date.parse("2026-11-02T18:05:00-08:00");
    const runs = {
      between: (from: number, to: number) =>
        [{ id: 42, start, elapsedSeconds: 30 * 60, distanceMeters: 5000 }].filter(
          (r) => r.start >= from && r.start < to,
        ),
    };
    const now = () => Date.parse("2026-11-03T12:00:00-08:00");

    await new DailySummary(raw, derived, vault, TZ, now, runs).run(DATE);

    const note = await vault.readDaily(DATE);
    expect(note?.body).toMatch(
      /- Running 18:05–18:35 · 30 min · 5\.0 km · 6:00 \/km · 165 avg \/ 165 max · strain \d/,
    );
    const rows = await derived.readAll("workouts", DATE);
    expect(rows).toEqual([
      expect.objectContaining({ status: "confirmed", strava_id: 42, distance_m: 5000 }),
    ]);
    // The strap's minutes either side of the run are free again: five each, next to the run.
    const walks = await derived.readAll("walks", DATE);
    expect(walks.map((w) => w.duration_min)).toEqual([5, 5]);
  });

  test("a Strava run's calories cover only its own window", async () => {
    await putNight();
    await writeProfile("weight_kg: 75\nheight_cm: 180\n");
    await putRun();
    const start = Date.parse("2026-11-02T18:05:00-08:00");
    const runs = {
      between: (from: number, to: number) =>
        [{ id: 42, start, elapsedSeconds: 30 * 60, distanceMeters: 5000 }].filter(
          (r) => r.start >= from && r.start < to,
        ),
    };
    const now = () => Date.parse("2026-11-03T12:00:00-08:00");
    const whole = (await summary.run(DATE))?.day.workouts[0]?.kcal ?? 0;

    const result = await new DailySummary(raw, derived, vault, TZ, now, runs).run(DATE);

    // 30 of the strap's 40 minutes, all at the same heart rate.
    const kcal = result?.day.workouts[0]?.kcal ?? 0;
    expect(kcal).toBeCloseTo((whole * 30) / 40, 0);
    const note = await vault.readDaily(DATE);
    expect(note?.body).toMatch(
      new RegExp(`- Running 18:05–18:35 · 30 min · 5\\.0 km · .* · ${Math.round(kcal)} kcal\n`),
    );
  });

  test("a day with no night before borrows the closest night's resting HR", async () => {
    // No night before DATE and no earlier nights, as on the day the strap was first worn.
    await writeProfile();
    await putRun();
    await putNextNight();

    const result = await summary.run(DATE);

    expect(result?.night).toBeNull();
    expect(result?.day.workouts.map((w) => w.kind)).toEqual(["running"]);
    expect(result?.day.strain).toBeGreaterThan(0);
  });

  test("a workout reviewed as not a workout leaves the note and the totals", async () => {
    await putNight();
    await writeProfile();
    await putRun();
    await summary.run(DATE);
    await vault.update(vault.dailyPath(DATE), (source) =>
      editNote(source, { frontmatter: {}, body: "" }, (note) => {
        writeReview(note.frontmatter, { start: "18:00", end: "18:40", kind: "none" });
        return note;
      }),
    );

    await summary.run(DATE);

    const note = await vault.readDaily(DATE);
    expect(note?.body).not.toContain("- Running");
    expect((await derived.readAll("workouts", DATE))[0]).toMatchObject({ status: "dismissed" });
    expect((await derived.read("days", DATE))?.workout_min).toBe(0);
  });

  test("a lifting log in the note is summarized, even before the strap has the session", async () => {
    await putNight();
    await writeProfile();
    await vault.appendJournal(new Date(SLEEP.end + HOUR), "Gym later.");
    const path = vault.dailyPath(DATE);
    const text = (await vault.read(path)) ?? "";
    await writeFile(
      join(dir, "vault", path),
      `${text}\n## Workouts\n- Chest Press\n    - 60lbs, 1x10\n    - 80lbs, 3x10\n`,
    );

    await summary.run(DATE);

    const note = await vault.readDaily(DATE);
    expect(note?.body).toContain(
      "- Lifting log · 1 exercise · 4 sets · 3,000 lb · not matched to the strap",
    );
    expect(note?.body).toContain("## Workouts\n- Chest Press");
    const sets = await derived.readAll("sets", DATE);
    expect(sets.map((s) => s.warm_up)).toEqual([1, 0, 0, 0]);
    expect(sets[0]).toMatchObject({ exercise: "Chest Press", weight: 60, reps: 10, peak_ts: null });
  });

  test("a day with no workouts leaves no workouts file", async () => {
    await derived.writeAll("workouts", DATE, [{ kind: "lifting" }]);

    await derived.writeAll("workouts", DATE, []);

    expect(await derived.readAll("workouts", DATE)).toEqual([]);
  });

  test("rerunning only replaces the Health block", async () => {
    await putNight();
    await summary.run(DATE);
    await vault.appendJournal(new Date(SLEEP.end + HOUR), "Felt good.");
    await summary.run(DATE);
    const text = await vault.read(vault.dailyPath(DATE));
    const body = parseNote(text ?? "").body;
    expect(body.match(/## Health/g)).toHaveLength(1);
    expect(body).toContain("- 08:00 Felt good.");
  });
});

describe("DailySummary synced line", () => {
  const Noon = Date.parse("2026-11-02T12:00:00-08:00");

  async function runToday(sampleAt: number): Promise<string> {
    const store = new RawStore(join(dir, "health-raw"), () => Noon);
    const day = new Date(sampleAt).toISOString().slice(0, 10);
    await store.store("heart_rate", day, {
      header: ["ts", "bpm"],
      samples: [{ ts: sampleAt, values: [60] }],
    });
    await new DailySummary(store, derived, vault, TZ, () => Noon).run(DATE);
    return (await vault.readDaily(DATE))?.body ?? "";
  }

  test("today's block says when data last arrived", async () => {
    const body = await runToday(Noon - 30 * 60_000);

    expect(body).toContain("- Synced 11:30\n");
  });

  test("flags how far behind once the data lags", async () => {
    const body = await runToday(Noon - 150 * 60_000);

    expect(body).toContain("- Synced 09:30 · **2h behind**");
  });

  test("today still gets the line when no data has arrived for it", async () => {
    const body = await runToday(Noon - 24 * HOUR);

    expect(body).toContain(
      "<!-- cc:health -->\n## Health\n\n- Synced 1 Nov 12:00 · **24h behind**",
    );
  });

  test("past days have no synced line", async () => {
    await putNight();

    await summary.run(DATE);

    expect((await vault.readDaily(DATE))?.body).not.toContain("Synced");
  });
});

describe("SummaryScheduler", () => {
  test("recomputes the local dates a UTC day can affect, oldest first", async () => {
    const ran: string[] = [];
    const record = async (date: string) => {
      ran.push(date);
      return null;
    };
    const now = () => Date.parse("2026-11-10T12:00:00Z");
    const scheduler = new SummaryScheduler({ run: record }, TZ, 60_000, now);
    scheduler.touchUtcDay("2026-11-03");
    scheduler.touchUtcDay("2026-11-02");
    await scheduler.flush();
    expect(ran).toEqual(["2026-11-01", "2026-11-02", "2026-11-03", "2026-11-04"]);
  });

  test("never schedules the future", async () => {
    const ran: string[] = [];
    const record = async (date: string) => {
      ran.push(date);
      return null;
    };
    const now = () => Date.parse("2026-11-03T12:00:00-08:00");
    const scheduler = new SummaryScheduler({ run: record }, TZ, 60_000, now);
    scheduler.touchUtcDay("2026-11-03");
    await scheduler.flush();
    expect(ran).toEqual(["2026-11-02", "2026-11-03"]);
  });
});
