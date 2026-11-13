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
const daily = "Daily/2026/2026-11-12.md";

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

  test("stats start at the first tick and follow edits made in Obsidian", async () => {
    await habits.create({ name: "Read", schedule: { kind: "daily" } });
    await habits.mark("read", "2026-11-10", true);
    await habits.mark("read", "2026-11-11", true);

    const before = await habits.stats("2026-11-12");
    await Bun.write(join(dir, daily), "---\nhabits: [read]\n---\n# 2026-11-12\n");
    const after = await habits.stats("2026-11-12");

    expect(before[0]).toMatchObject({
      start: "2026-11-10",
      stats: { streak: 2, doneToday: false },
    });
    expect(after[0]?.stats).toMatchObject({
      streak: 3,
      doneToday: true,
      recent: { done: 3, of: 3 },
    });
  });

  test("a habit's since date makes earlier days count as missed", async () => {
    await habits.create({ name: "Read", schedule: { kind: "daily" }, since: "2026-11-01" });
    await habits.mark("read", "2026-11-11", true);

    const [read] = await habits.stats("2026-11-12");

    await habits.mark("read", "2026-10-30", true);
    const [fixed] = await habits.stats("2026-11-12");

    expect(read?.start).toBe("2026-11-01");
    expect(read?.stats.recent).toEqual({ done: 1, of: 11 });
    expect(fixed?.start).toBe("2026-10-30");
    expect(await file("Habits.md")).toContain("· since 2026-11-01 <!-- id:read -->");
  });

  test("a hand tick wins; on other days the mark callback says how it went", async () => {
    await habits.create({ name: "Steps", schedule: { kind: "daily" }, since: "2026-11-10" });
    await habits.mark("steps", "2026-11-10", true);

    const [steps] = await habits.stats("2026-11-12", (_, date) =>
      date === "2026-11-11" ? "done" : "open",
    );

    expect(steps?.stats).toMatchObject({ streak: 2, recent: { done: 2, of: 2 } });
  });
});
