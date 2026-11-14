import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm, utimes } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { LiftingStore } from "../../src/lifting/lifting-store";
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
