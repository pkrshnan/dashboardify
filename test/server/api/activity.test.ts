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
        },
      ],
      walks: [{ steps: 2100, briskMinutes: 14 }],
    });
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
});
