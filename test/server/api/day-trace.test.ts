import { describe, expect, test } from "bun:test";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DerivedStore } from "../../../src/health/derived-store";
import { RawStore } from "../../../src/health/raw-store";
import { dayTrace } from "../../../src/server/api/day-trace";
import { Vault } from "../../../src/vault/vault";
import { useApi } from "./helpers";

// The test server is on UTC, and its now is 3 Nov 12:00, so 2 Nov is a whole day.
const DAY = "2026-11-02";
const START = Date.parse(`${DAY}T00:00:00Z`);
const MIN = 60_000;

type Series = { kind: string; values: number[]; missingIndexes?: number[]; low?: number[] };
type Span = { kind: string; startTime: string; endTime: string; workoutKind?: string };

describe("day trace API", () => {
  const api = useApi();

  const raw = () => new RawStore(join(api.dir, "raw"));
  const derived = () => new DerivedStore(join(api.dir, "derived"));

  /** Five minutes of 1 Hz heart rate, steps and skin temperature from 08:00. */
  async function seedStreams(day = DAY) {
    const from = Date.parse(`${day}T08:00:00Z`);
    const ts = Array.from({ length: 300 }, (_, i) => from + i * 1000);
    const store = raw();
    await store.store("heart_rate", day, {
      header: ["ts", "bpm"],
      samples: ts.map((t, i) => ({ ts: t, values: [i % 2 === 0 ? 70 : 74] })),
    });
    await store.store("steps", day, {
      header: ["ts", "count"],
      samples: ts.map((t, i) => ({ ts: t, values: [1000 + i] })),
    });
    await store.store("temperature", day, {
      header: ["ts", "celsius"],
      samples: ts.map((t) => ({ ts: t, values: [33.5] })),
    });
  }

  test("a past day is a whole day of buckets, gaps listed as missing", async () => {
    await seedStreams();

    const { status, body } = await api.call(`/v1/days/${DAY}/trace`);

    expect(status).toBe(200);
    expect(body).toMatchObject({
      name: `days/${DAY}/trace`,
      startTime: "2026-11-02T00:00:00Z",
      endTime: "2026-11-03T00:00:00Z",
    });
    const [hr, steps, temp] = body.series as Series[];
    expect(body.series.map((s: Series) => s.kind)).toEqual([
      "KIND_HEART_RATE",
      "KIND_STEPS",
      "KIND_SKIN_TEMPERATURE",
    ]);
    expect(hr?.values).toHaveLength(1440);
    expect(hr?.values[480]).toBe(72);
    expect(hr?.low?.[480]).toBe(70);
    expect(hr?.missingIndexes).toHaveLength(1435);
    expect(hr?.missingIndexes).not.toContain(480);
    expect(steps?.values).toHaveLength(288);
    expect(steps?.values[96]).toBe(299);
    expect(temp?.values[484]).toBe(33.5);
  });

  test("today stops at now", async () => {
    await seedStreams("2026-11-03");

    const { body } = await api.call("/v1/days/2026-11-03/trace");

    expect(body.endTime).toBe("2026-11-03T12:00:00Z");
    expect(body.series[0].values).toHaveLength(720);
  });

  test("a day without data is an empty trace", async () => {
    const { status, body } = await api.call("/v1/days/2026-10-01/trace");

    expect(status).toBe(200);
    expect(body.series[0].missingIndexes).toHaveLength(1440);
    expect(body.spans ?? []).toEqual([]);
    expect(body).not.toHaveProperty("maxHeartRate");
  });

  test("sleep, workouts, walks and time not worn are spans cut to the day", async () => {
    const store = derived();
    await store.write("nights", DAY, { bed_ts: START - 60 * MIN, wake_ts: START + 420 * MIN });
    await store.write("nights", "2026-11-03", {
      bed_ts: START + 1380 * MIN,
      wake_ts: START + 1860 * MIN,
    });
    await store.writeAll("workouts", DAY, [
      {
        status: "confirmed",
        kind: "lifting",
        start_ts: START + 600 * MIN,
        end_ts: START + 640 * MIN,
      },
      {
        status: "dismissed",
        kind: "workout",
        start_ts: START + 700 * MIN,
        end_ts: START + 710 * MIN,
      },
    ]);
    await store.writeAll("walks", DAY, [
      { start_ts: START + 500 * MIN, end_ts: START + 520 * MIN },
    ]);
    await raw().store("wear", DAY, {
      header: ["ts", "on", "source"],
      samples: [
        { ts: START + 800 * MIN, values: [0, "debug_log"] },
        { ts: START + 830 * MIN, values: [1, "debug_log"] },
      ],
    });

    const { body } = await api.call(`/v1/days/${DAY}/trace`);

    expect(
      (body.spans as Span[]).map((s) => [s.kind, s.workoutKind ?? "", s.startTime, s.endTime]),
    ).toEqual([
      ["KIND_SLEEP", "", "2026-11-02T00:00:00Z", "2026-11-02T07:00:00Z"],
      ["KIND_WALK", "", "2026-11-02T08:20:00Z", "2026-11-02T08:40:00Z"],
      ["KIND_WORKOUT", "lifting", "2026-11-02T10:00:00Z", "2026-11-02T10:40:00Z"],
      ["KIND_NOT_WORN", "", "2026-11-02T13:20:00Z", "2026-11-02T13:50:00Z"],
      ["KIND_SLEEP", "", "2026-11-02T23:00:00Z", "2026-11-03T00:00:00Z"],
    ]);
  });

  test("max HR comes from the profile", async () => {
    await writeFile(join(api.dir, "vault", "Profile.md"), "---\nbirth_date: 2000-01-01\n---\n");

    const { body } = await api.call(`/v1/days/${DAY}/trace`);

    expect(body.maxHeartRate).toBeCloseTo(208 - 0.7 * 26);
  });

  test("over Connect too", async () => {
    const { status, body } = await api.call(
      "/dashboardify.v1.ActivityService/GetDayTrace",
      "POST",
      { name: `days/${DAY}/trace` },
    );

    expect(status).toBe(200);
    expect(body.series).toHaveLength(3);
  });

  test("a bad name is rejected", async () => {
    const { status } = await api.call("/v1/days/2026-13-40/trace");

    expect(status).toBe(400);
  });
});

describe("dayTrace", () => {
  test("a local day reads both UTC days it spans", async () => {
    const dir = await mkdtemp(join(tmpdir(), "day-trace-"));
    const raw = new RawStore(join(dir, "raw"));
    // 23:30 in Los Angeles on 2 Nov is 07:30 UTC on 3 Nov.
    const late = Date.parse("2026-11-03T07:30:00Z");
    await raw.store("heart_rate", "2026-11-03", {
      header: ["ts", "bpm"],
      samples: Array.from({ length: 60 }, (_, i) => ({ ts: late + i * 1000, values: [65] })),
    });

    const trace = await dayTrace(
      {
        raw,
        derived: new DerivedStore(join(dir, "derived")),
        vault: new Vault(join(dir, "vault"), "America/Los_Angeles"),
        timeZone: "America/Los_Angeles",
        recompute: async () => undefined,
        now: () => Date.parse("2026-11-10T00:00:00Z"),
      },
      DAY,
    );

    expect(trace.startTime).toBe("2026-11-02T08:00:00.000Z");
    expect(trace.series[0]?.values).toHaveLength(1440);
    expect(trace.series[0]?.values[23 * 60 + 30]).toBe(65);
    await rm(dir, { recursive: true, force: true });
  });
});
