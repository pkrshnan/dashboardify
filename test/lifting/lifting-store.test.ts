import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiftingStore, StaleLog } from "../../src/lifting/lifting-store";
import { Vault } from "../../src/vault/vault";

let dir: string;
let lifting: LiftingStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "lifting-"));
  lifting = new LiftingStore(new Vault(dir, "UTC"));
  await Bun.write(
    join(dir, "Daily/2026/2026-11-12.md"),
    "# 2026-11-12\n\n## Workouts\n- Leg Press\n    - 200lbs, 3x10\n\n## Journal\n",
  );
  await Bun.write(
    join(dir, "Daily/2026/2026-11-08.md"),
    "## Workouts\n- Chest Press\n    - 80lbs, 3x10\n",
  );
  await Bun.write(join(dir, "Daily/2026/2026-11-10.md"), "## Journal\n- 09:00 Rest day.\n");
  await Bun.write(join(dir, "Daily/2026/notes.md"), "## Workouts\n- Squat\n    - 3x5\n");
});
afterEach(() => rm(dir, { recursive: true, force: true }));

describe("LiftingStore", () => {
  test("reads the days with a log, oldest first, and skips other notes", async () => {
    const days = await lifting.days();

    expect(days.map((d) => [d.date, d.exercises.map((e) => e.name)])).toEqual([
      ["2026-11-08", ["Chest Press"]],
      ["2026-11-12", ["Leg Press"]],
    ]);
  });

  test("builds each exercise's history, most recent first", async () => {
    const histories = await lifting.histories();

    expect(histories.map((h) => h.title)).toEqual(["Leg Press", "Chest Press"]);
  });

  test("reads a note again once it changes", async () => {
    await lifting.days();
    const path = join(dir, "Daily/2026/2026-11-08.md");
    await Bun.write(path, "## Workouts\n- Chest Press\n    - 80lbs, 3x11\n");
    const later = new Date(Date.now() + 60_000);
    await utimes(path, later, later);

    const [chest] = (await lifting.days()).filter((d) => d.date === "2026-11-08");

    expect(chest?.exercises[0]?.lines[0]?.reps).toBe(11);
  });
});

describe("writing a day's log", () => {
  const press = [
    { weight: 60, reps: 10, warmUp: true },
    { weight: 80, reps: 11, warmUp: false },
  ];

  test("adds the exercise to the day's note and returns the new log", async () => {
    const before = await lifting.day("2026-11-12");

    const after = await lifting.putExercise("2026-11-12", "Chest Press", "lb", press, before.etag);

    expect(after.exercises.map((e) => e.name)).toEqual(["Leg Press", "Chest Press"]);
    expect(await Bun.file(join(dir, "Daily/2026/2026-11-12.md")).text()).toContain(
      "- Chest Press\n    - 60lbs, 1x10, warm-up\n    - 80lbs, 1x11\n\n## Journal",
    );
    expect(after.etag).not.toBe(before.etag);
  });

  test("makes the day's note when there isn't one", async () => {
    await lifting.putExercise("2026-11-14", "Chest Press", "lb", press);

    const text = await Bun.file(join(dir, "Daily/2026/2026-11-14.md")).text();
    expect(text).toContain("## Workouts\n- Chest Press\n");
    expect(text).toContain("## Journal");
  });

  test("refuses a stale etag and leaves the note as it was", async () => {
    const { etag } = await lifting.day("2026-11-12");
    await lifting.removeExercise("2026-11-12", "Leg Press");

    await expect(
      lifting.putExercise("2026-11-12", "Chest Press", "lb", press, etag),
    ).rejects.toThrow(StaleLog);
    expect((await lifting.day("2026-11-12")).exercises).toEqual([]);
  });

  test("another section changing doesn't make the etag stale", async () => {
    const { etag } = await lifting.day("2026-11-12");
    const path = join(dir, "Daily/2026/2026-11-12.md");
    await Bun.write(path, `${await Bun.file(path).text()}- 10:00 Journal line.\n`);

    expect((await lifting.day("2026-11-12")).etag).toBe(etag);
  });
});
