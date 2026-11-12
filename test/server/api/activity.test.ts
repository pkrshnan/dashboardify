import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DerivedStore } from "../../../src/health/derived-store";
import { RawStore } from "../../../src/health/raw-store";
import { parseNote } from "../../../src/vault/markdown";
import { useApi } from "./helpers";

const DAY = "2026-11-04";
const START = Date.parse(`${DAY}T18:07:00Z`);
const END = Date.parse(`${DAY}T18:31:00Z`);

describe("activity API", () => {
  const recomputed: string[] = [];
  const api = useApi({
    recompute: async (date) => {
      recomputed.push(date);
    },
  });

  /** One day's computed tables, as the daily summary writes them. The test server is on UTC. */
  async function seed() {
    const derived = new DerivedStore(join(api.dir, "derived"));
    await derived.write("days", DAY, { steps: 1764, worn_min: 1400 });
    await derived.writeAll("workouts", DAY, [
      {
        status: "possible",
        start_ts: START,
        end_ts: END,
        kind: "lifting",
        duration_min: 24,
        avg_hr: 105,
        max_hr: 120,
        cadence_spm: 0,
        trimp: 3,
        strain: 1.5,
        kcal: 210,
      },
    ]);
    await derived.writeAll("walks", DAY, [
      {
        start_ts: START - 3_600_000,
        end_ts: START - 2_400_000,
        duration_min: 20,
        steps: 2100,
        cadence_spm: 105,
        brisk_min: 14,
        avg_hr: null,
      },
    ]);
    const raw = new RawStore(join(api.dir, "raw"));
    const samples = Array.from({ length: 60 }, (_, i) => ({ ts: START + i * 1000, values: [100] }));
    await raw.store("heart_rate", DAY, { header: ["ts", "bpm"], samples });
  }

  test("lists days with their workouts and walks", async () => {
    await seed();

    const { status, body } = await api.call(
      "/v1/activityDays?startDate.year=2026&startDate.month=11&startDate.day=1&endDate.year=2026&endDate.month=11&endDate.day=8",
    );

    expect(status).toBe(200);
    expect(body.days).toHaveLength(1);
    expect(body.days[0]).toMatchObject({
      date: { year: 2026, month: 11, day: 4 },
      steps: 1764,
      workouts: [
        {
          name: "days/2026-11-04/workouts/1807",
          kind: "lifting",
          status: "WORKOUT_STATUS_POSSIBLE",
          durationMinutes: 24,
          calories: 210,
        },
      ],
      walks: [{ steps: 2100, briskMinutes: 14 }],
    });
  });

  test("a Strava run carries its distance and activity", async () => {
    await seed();
    const derived = new DerivedStore(join(api.dir, "derived"));
    const [lifting] = await derived.readAll("workouts", DAY);
    await derived.writeAll("workouts", DAY, [
      { ...lifting, distance_m: null, strava_id: null },
      {
        ...lifting,
        status: "confirmed",
        kind: "running",
        start_ts: END + 600_000,
        end_ts: END + 2_400_000,
        distance_m: 5100,
        strava_id: 16_000_000_001,
      },
    ]);

    const { body } = await api.call("/v1/days/2026-11-04/workouts/1841");
    const { body: lifted } = await api.call("/v1/days/2026-11-04/workouts/1807");

    expect(body).toMatchObject({ distanceMeters: 5100, stravaActivityId: "16000000001" });
    // The walk before the run ends 18:00, far from 18:41, so the window is the run's alone.
    expect(body.heartRateStartTime).toBe("2026-11-04T18:36:00Z");
    expect(lifted.distanceMeters).toBeUndefined();
    expect(lifted.stravaActivityId).toBeUndefined();
  });

  test("a Strava run's heart rate covers the walks either side", async () => {
    await seed();
    const derived = new DerivedStore(join(api.dir, "derived"));
    const [lifting] = await derived.readAll("workouts", DAY);
    const run = { start: START + 14 * 60_000, end: START + 46 * 60_000 };
    await derived.writeAll("workouts", DAY, [
      { ...lifting, kind: "running", start_ts: run.start, end_ts: run.end, strava_id: 7 },
    ]);
    await derived.writeAll("walks", DAY, [
      { start_ts: START, end_ts: run.start, duration_min: 14, steps: 1500 },
      { start_ts: run.end, end_ts: run.end + 16 * 60_000, duration_min: 16, steps: 1600 },
    ]);

    const { body } = await api.call("/v1/days/2026-11-04/workouts/1821");

    expect(body.heartRateStartTime).toBe("2026-11-04T18:02:00Z");
    expect(body.heartRate).toHaveLength(72 * 4);
  });

  test("a workout comes with heart rate every 15 seconds", async () => {
    await seed();

    const { status, body } = await api.call("/v1/days/2026-11-04/workouts/1807");

    expect(status).toBe(200);
    expect(body.heartRateStartTime).toBe("2026-11-04T18:02:00Z");
    // 5 minutes either side of 24: 34 minutes of 15-second steps.
    expect(body.heartRate).toHaveLength(136);
    expect(body.heartRate.slice(19, 25)).toEqual([0, 100, 100, 100, 100, 0]);
  });

  test("a workout without calories leaves the field out", async () => {
    await seed();
    const derived = new DerivedStore(join(api.dir, "derived"));
    const [row] = await derived.readAll("workouts", DAY);
    await derived.writeAll("workouts", DAY, [{ ...row, kcal: null }]);

    const { status, body } = await api.call("/v1/days/2026-11-04/workouts/1807");

    expect(status).toBe(200);
    expect(body.strain).toBe(1.5);
    expect(body).not.toHaveProperty("calories");
  });

  test("a review goes into the daily note and recomputes the day", async () => {
    await seed();

    const { status } = await api.call("/v1/days/2026-11-04/workouts/1807:review", "POST", {
      kind: "none",
    });

    expect(status).toBe(200);
    expect(recomputed).toContain(DAY);
    const note = parseNote(await Bun.file(join(api.dir, "vault/daily/2026/2026-11-04.md")).text());
    expect(note.frontmatter.workout_reviews).toEqual([
      { start: "18:07", end: "18:31", kind: "none" },
    ]);
  });

  test("unknown workouts, bad kinds and long ranges are refused", async () => {
    await seed();

    const missing = await api.call("/v1/days/2026-11-04/workouts/0900");
    const badKind = await api.call("/v1/days/2026-11-04/workouts/1807:review", "POST", {
      kind: "dancing",
    });
    const tooLong = await api.call(
      "/v1/activityDays?startDate.year=2026&startDate.month=1&startDate.day=1&endDate.year=2026&endDate.month=11&endDate.day=8",
    );

    expect(missing.status).toBe(404);
    expect(badKind.status).toBe(400);
    expect(tooLong.status).toBe(400);
  });

  describe("nights", () => {
    const Bed = Date.parse("2026-11-03T23:10:00Z");
    const Onset = Date.parse("2026-11-03T23:25:00Z");
    const Wake = Date.parse(`${DAY}T07:05:00Z`);
    const Night = {
      bed_ts: Bed,
      onset_ts: Onset,
      wake_ts: Wake,
      tst_min: 432,
      sleep_score: 84,
      light_min: 250,
      deep_min: 82,
      rem_min: 100,
      stages_plausible: 1,
    };

    async function seedNight(night: Record<string, number | null>, stages: string[]) {
      const derived = new DerivedStore(join(api.dir, "derived"));
      await derived.write("nights", DAY, night);
      const step = (Wake - Bed) / Math.max(stages.length, 1);
      await derived.writeAll(
        "stages",
        DAY,
        stages.map((stage, i) => ({
          start_ts: Bed + i * step,
          end_ts: Bed + (i + 1) * step,
          stage,
        })),
      );
    }

    test("a night comes with its times, stage minutes and stage runs", async () => {
      await seedNight(Night, ["awake", "light", "deep", "rem"]);

      const { status, body } = await api.call("/v1/days/2026-11-04/night");

      expect(status).toBe(200);
      expect(body).toMatchObject({
        name: "days/2026-11-04/night",
        bedTime: "2026-11-03T23:10:00Z",
        onsetTime: "2026-11-03T23:25:00Z",
        wakeTime: "2026-11-04T07:05:00Z",
        asleepMinutes: 432,
        sleepScore: 84,
        lightMinutes: 250,
        deepMinutes: 82,
        remMinutes: 100,
        stagesPlausible: true,
      });
      expect(body.stages.map((r: { stage: string }) => r.stage)).toEqual([
        "STAGE_AWAKE",
        "STAGE_LIGHT",
        "STAGE_DEEP",
        "STAGE_REM",
      ]);
      expect(body.stages[0].startTime).toBe("2026-11-03T23:10:00Z");
      expect(body.stages.at(-1).endTime).toBe("2026-11-04T07:05:00Z");
    });

    test("the same night over Connect", async () => {
      await seedNight(Night, ["light"]);

      const { status, body } = await api.call("/dashboardify.v1.ActivityService/GetNight", "POST", {
        name: "days/2026-11-04/night",
      });

      expect(status).toBe(200);
      expect(body.stages).toHaveLength(1);
    });

    test("a night without stages leaves the stage fields out", async () => {
      await seedNight(
        { ...Night, light_min: null, deep_min: null, rem_min: null, stages_plausible: null },
        [],
      );

      const { status, body } = await api.call("/v1/days/2026-11-04/night");

      expect(status).toBe(200);
      expect(body.asleepMinutes).toBe(432);
      expect(body).not.toHaveProperty("deepMinutes");
      expect(body).not.toHaveProperty("stagesPlausible");
      expect(body.stages ?? []).toEqual([]);
    });

    test("an implausible night says so", async () => {
      await seedNight({ ...Night, stages_plausible: 0 }, ["light"]);

      const { body } = await api.call("/v1/days/2026-11-04/night");

      expect(body.stagesPlausible).toBe(false);
    });

    test("a day with no night is not found, and a bad name is refused", async () => {
      await seedNight(Night, []);

      const missing = await api.call("/v1/days/2026-11-05/night");
      const badName = await api.call("/dashboardify.v1.ActivityService/GetNight", "POST", {
        name: "days/2026-11-04/nights",
      });

      expect(missing.status).toBe(404);
      expect(badName.status).toBe(400);
    });
  });
});
