import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DailySummary } from "../../src/health/daily-summary";
import { DerivedStore } from "../../src/health/derived-store";
import { RawStore, utcDays } from "../../src/health/raw-store";
import type { Sample } from "../../src/health/samples";
import { SummaryScheduler } from "../../src/health/scheduler";
import { parseNote } from "../../src/vault/markdown";
import { Vault } from "../../src/vault/vault";
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

describe("DailySummary", () => {
  test("no data writes nothing", async () => {
    expect(await summary.run(DATE)).toBeNull();
    expect(await vault.readDaily(DATE)).toBeNull();
  });

  test("writes the night and day to the daily note and the derived tables", async () => {
    await putNight();
    await mkdir(join(dir, "vault"), { recursive: true });
    await writeFile(
      join(dir, "vault", "profile.md"),
      "---\nbirth_date: 1996-05-01\nsex: male\n---\n",
    );
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
    expect((await derived.read("days", DATE))?.algo_version).toBe("1");
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
