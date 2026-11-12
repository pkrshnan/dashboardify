import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { HabitNotFound, HabitStore, InvalidHabit, StaleHabits } from "../../src/habits/habit-store";
import { Vault } from "../../src/vault/vault";

let dir: string;
let vault: Vault;
let habits: HabitStore;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "habits-"));
  vault = new Vault(dir, "UTC");
  habits = new HabitStore(vault);
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const file = (rel: string) => readFile(join(dir, rel), "utf8");
const daily = "daily/2026/2026-11-12.md";

describe("HabitStore", () => {
  test("starts Habits.md with the first habit and gives it a colour", async () => {
    const read = await habits.create({ name: " Read ", schedule: { kind: "daily" } });

    expect(read).toMatchObject({ id: "read", name: "Read", color: "#BF5AF2", state: "active" });
    expect(await file("Habits.md")).toBe("# Habits\n\n- Read · daily · #BF5AF2 <!-- id:read -->\n");
  });

  test("reads an empty list when there's no Habits.md", async () => {
    expect((await habits.read()).habits).toEqual([]);
  });

  test("refuses a bad name or schedule", async () => {
    const bad = [
      { name: "a · b", schedule: { kind: "daily" as const } },
      { name: "Lift", schedule: { kind: "weekly" as const, times: 0 } },
      { name: "Floss", schedule: { kind: "days" as const, days: [] } },
    ];
    for (const fields of bad) {
      await expect(habits.create(fields)).rejects.toBeInstanceOf(InvalidHabit);
    }
  });

  test("edits a habit with the current etag and refuses a stale one", async () => {
    await habits.create({ name: "Lift", schedule: { kind: "weekly", times: 3 } });
    const { etag } = await habits.read();

    const lift = await habits.update("lift", etag, { schedule: { kind: "weekly", times: 4 } });
    const stale = habits.update("lift", etag, { state: "paused" });

    expect(lift.schedule).toEqual({ kind: "weekly", times: 4 });
    await expect(stale).rejects.toBeInstanceOf(StaleHabits);
    await expect(habits.update("nope", undefined, {})).rejects.toBeInstanceOf(HabitNotFound);
  });

  test("ticks a day in the daily note's frontmatter, once however often it's sent", async () => {
    await habits.create({ name: "Read", schedule: { kind: "daily" } });
    await habits.create({ name: "Meditate", schedule: { kind: "daily" } });

    await habits.mark("read", "2026-11-12", true);
    await habits.mark("read", "2026-11-12", true);
    await habits.mark("meditate", "2026-11-12", true);

    expect(await file(daily)).toContain("habits:\n  - read\n  - meditate\n");
    expect(await habits.marks("2026-11-11", "2026-11-13")).toEqual(
      new Map([["2026-11-12", new Set(["read", "meditate"])]]),
    );
  });

  test("unticking removes the key, and keeps the rest of the note", async () => {
    await habits.create({ name: "Read", schedule: { kind: "daily" } });
    await Bun.write(join(dir, daily), "---\nsteps: 8412\n---\n# 2026-11-12\n\nMine.\n");

    await habits.mark("read", "2026-11-12", true);
    await habits.mark("read", "2026-11-12", false);

    expect(await file(daily)).toBe("---\nsteps: 8412\n---\n# 2026-11-12\n\nMine.\n");
  });

  test("unticking a day without a note doesn't make one", async () => {
    await habits.create({ name: "Read", schedule: { kind: "daily" } });

    await habits.mark("read", "2026-11-12", false);

    expect(await vault.read(daily)).toBeNull();
  });

  test("refuses an unknown habit or a date that isn't one", async () => {
    await habits.create({ name: "Read", schedule: { kind: "daily" } });

    await expect(habits.mark("nope", "2026-11-12", true)).rejects.toBeInstanceOf(HabitNotFound);
    await expect(habits.mark("read", "2026-02-30", true)).rejects.toBeInstanceOf(InvalidHabit);
  });
});
