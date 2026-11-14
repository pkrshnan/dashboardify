import { beforeEach, describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DerivedStore } from "../../../src/health/derived-store";
import { useApi } from "./helpers";

// The test clock is 3 November 2026.
const OCT_27 = "## Workouts\n- Chest Press\n    - 60lbs, 1x10, warm-up\n    - 80lbs, 2x10, 1x9\n";
const NOV_1 = "## Workouts\n- Chest Press\n    - 60lbs, 1x10, warm-up\n    - 80lbs, 3x10\n";
const MIN = 60_000;

describe("LiftingService", () => {
  const api = useApi();

  beforeEach(async () => {
    await Bun.write(join(api.dir, "vault/Daily/2026/2026-10-27.md"), OCT_27);
    await Bun.write(join(api.dir, "vault/Daily/2026/2026-11-01.md"), NOV_1);
    const start = Date.UTC(2026, 10, 1, 18);
    await new DerivedStore(join(api.dir, "derived")).writeAll(
      "sets",
      "2026-11-01",
      [0, 3, 6, 9].map((m, i) => ({
        exercise: "Chest Press",
        warm_up: i === 0 ? 1 : 0,
        start_ts: start + m * MIN,
        peak_ts: start + (m + 1) * MIN,
        peak_hr: 120 + i * 5,
      })),
    );
  });

  test("lists exercises with their last session and next time", async () => {
    const { body } = await api.call("/v1/exercises");

    expect(body.exercises).toHaveLength(1);
    const [chest] = body.exercises;
    expect(chest).toMatchObject({
      name: "exercises/chest-press",
      title: "Chest Press",
      unit: "lb",
      repRange: { low: 8, high: 12, step: 5 },
      nextTime: { reason: "more-reps" },
    });
    expect(chest.sessions).toHaveLength(1);
    expect(chest.sessions[0]).toMatchObject({
      date: { year: 2026, month: 11, day: 1 },
      topWeight: 80,
      repsAtTop: [10, 10, 10],
      progress: "reps",
      restSeconds: 120,
      peakHeartRate: 130,
    });
    expect(chest.nextTime.sets.map((s: { reps: number }) => s.reps)).toEqual([10, 11, 11, 11]);
  });

  test("gets one exercise with every session and its records", async () => {
    const { body } = await api.call("/v1/exercises/chest-press");

    expect(body.sessions.map((s: { date: { day: number } }) => s.date.day)).toEqual([1, 27]);
    expect(body.sessions[0].records).toEqual(["est_one_rep_max", "at_top"]);
    expect(body.records).toMatchObject({ heaviest: 80, repsAtTop: [10, 10, 10] });
    expect((await api.call("/v1/exercises/squat")).status).toBe(404);
  });

  test("setting the rep range writes the exercise's note and changes next time", async () => {
    const { status, body } = await api.call("/v1/exercises/chest-press", "PATCH", {
      repRange: { low: 6, high: 10, step: 2.5 },
    });

    expect(status).toBe(200);
    expect(body.nextTime).toMatchObject({ reason: "add-weight" });
    expect(await api.vaultFile("Lifting/Chest Press.md")).toStartWith(
      "---\nreps: 6-10\nstep: 2.5\n---\n",
    );
    const bad = await api.call("/v1/exercises/chest-press", "PATCH", {
      repRange: { low: 12, high: 8, step: 5 },
    });
    expect(bad.status).toBe(400);
  });

  test("logs sets into the day's note, one exercise at a time", async () => {
    const day = await api.call("/v1/days/2026-11-03/lifting");
    expect(day.body).toMatchObject({ name: "days/2026-11-03/lifting" });

    const { status, body } = await api.call(
      `/v1/days/2026-11-03/lifting/exercises/chest-press?etag=${day.body.etag}`,
      "PATCH",
      {
        sets: [
          { weight: 60, reps: 10, warmUp: true },
          { weight: 80, reps: 11 },
          { weight: 80, reps: 11 },
          { weight: 80, reps: 10 },
        ],
      },
    );

    expect(status).toBe(200);
    expect(body.exercises).toEqual([
      expect.objectContaining({
        name: "days/2026-11-03/lifting/exercises/chest-press",
        title: "Chest Press",
        unit: "lb",
      }),
    ]);
    expect(await api.vaultFile("Daily/2026/2026-11-03.md")).toContain(
      "## Workouts\n- Chest Press\n    - 60lbs, 1x10, warm-up\n    - 80lbs, 2x11, 1x10\n",
    );
  });

  test("a new exercise needs a title; a stale etag is refused", async () => {
    const path = "/v1/days/2026-11-03/lifting/exercises/leg-press";
    const sets = [{ weight: 200, reps: 10 }];

    expect((await api.call(path, "PATCH", { sets })).status).toBe(400);
    expect((await api.call(path, "PATCH", { title: "Leg Press", sets })).status).toBe(200);
    expect((await api.call(`${path}?etag=old`, "PATCH", { title: "Leg Press", sets })).status).toBe(
      409,
    );
  });

  test("removes an exercise from the day's log", async () => {
    const { status, body } = await api.call(
      "/v1/days/2026-11-01/lifting/exercises/chest-press",
      "DELETE",
    );

    expect(status).toBe(200);
    expect(body.exercises ?? []).toEqual([]);
    expect(await api.vaultFile("Daily/2026/2026-11-01.md")).not.toContain("Chest Press");
    expect(
      (await api.call("/v1/days/2026-11-01/lifting/exercises/chest-press", "DELETE")).status,
    ).toBe(404);
  });
});
