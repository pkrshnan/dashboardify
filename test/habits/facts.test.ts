import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  afterNoon,
  autoMark,
  autoMarker,
  FactReader,
  factsFrom,
  parseRule,
} from "../../src/habits/facts";
import { HabitStore, InvalidHabit } from "../../src/habits/habit-store";
import { DerivedStore } from "../../src/health/derived-store";
import { parseNote } from "../../src/vault/markdown";
import { Vault } from "../../src/vault/vault";

const NOTE = parseNote(`---
steps: 8412
strain: 11.4
active_kcal: 610
feel: 4
---
# 2026-11-11

## Journal
- 07:55 Gym felt heavy.
- 22:10 Long day.
  Second line of the same entry.
`);
// 23:12 on 11 Nov in London.
const BED = Date.parse("2026-11-11T23:12:00Z");

describe("parseRule", () => {
  test("reads a fact, ≥ or ≤ (or >= and <=), and a value in the fact's units", () => {
    expect(parseRule("steps ≥ 8000")).toEqual({ fact: "steps", op: ">=", value: 8000 });
    expect(parseRule("steps>=8,500")).toEqual({ fact: "steps", op: ">=", value: 8500 });
    expect(parseRule("lights_out <= 23:30")).toEqual({ fact: "lights_out", op: "<=", value: 690 });
    expect(parseRule("lights_out ≤ 00:30")?.value).toBe(750);
  });

  test("a bare fact takes its default", () => {
    expect(parseRule("lifting")).toEqual({ fact: "lifting", op: ">=", value: 1 });
    expect(parseRule("lights_out")).toEqual({ fact: "lights_out", op: "<=", value: 690 });
  });

  test("refuses unknown facts and values that don't fit", () => {
    for (const text of ["bogus ≥ 1", "steps ≥ lots", "lights_out ≤ 25:00", "steps = 3", ""]) {
      expect(parseRule(text)).toBeNull();
    }
  });

  test("times compare from noon, so 00:20 is later than 23:30", () => {
    expect(afterNoon(20)).toBeGreaterThan(afterNoon(23 * 60 + 30));
  });
});

describe("factsFrom", () => {
  test("reads each fact from the note, the next morning and the derived rows", () => {
    const facts = factsFrom(
      {
        note: NOTE,
        nextNote: parseNote("---\ntst_min: 432\n---\n"),
        day: { zone1_min: 50, zone2_min: 20, zone3_min: 8, zone4_min: 2, zone5_min: null },
        nextNight: { bed_ts: BED },
        workouts: [
          { kind: "lifting", status: "confirmed" },
          { kind: "volleyball", status: "detected" },
          { kind: "running", status: "possible" },
          { kind: "walking", status: "dismissed" },
        ],
      },
      "Europe/London",
    );

    expect(facts).toEqual({
      steps: 8412,
      strain: 11.4,
      active_kcal: 610,
      feel: 4,
      zone2_min: 30,
      asleep_min: 432,
      lights_out: afterNoon(23 * 60 + 12),
      journal: 2,
      workouts: 2,
      lifting: 1,
      running: 0,
      volleyball: 1,
      walking: 0,
    });
  });

  test("leaves out what there's no data for", () => {
    const empty = { note: null, nextNote: null, day: null, nextNight: null, workouts: [] };

    expect(factsFrom(empty, "UTC")).toEqual({});
  });
});

describe("autoMark", () => {
  const steps = { fact: "steps" as const, op: ">=" as const, value: 8000 };
  const lightsOut = { fact: "lights_out" as const, op: "<=" as const, value: 690 };

  test("a fact that passes is done; one that doesn't is a miss once the day is over", () => {
    expect(autoMark(steps, { steps: 8412 }, "2026-11-10", "2026-11-12")).toBe("done");
    expect(autoMark(steps, { steps: 3000 }, "2026-11-10", "2026-11-12")).toBe("open");
    expect(autoMark(steps, {}, "2026-11-10", "2026-11-12")).toBe("open");
  });

  test("today stays pending until it passes", () => {
    expect(autoMark(steps, { steps: 3000 }, "2026-11-12", "2026-11-12")).toBe("pending");
    expect(autoMark(steps, { steps: 9000 }, "2026-11-12", "2026-11-12")).toBe("done");
  });

  test("a night waits for the next morning", () => {
    expect(autoMark(lightsOut, {}, "2026-11-12", "2026-11-12")).toBe("pending");
    expect(autoMark(lightsOut, {}, "2026-11-11", "2026-11-12")).toBe("pending");
    expect(autoMark(lightsOut, {}, "2026-11-10", "2026-11-12")).toBe("open");
    expect(autoMark(lightsOut, { lights_out: 750 }, "2026-11-10", "2026-11-12")).toBe("open");
  });
});

describe("with the vault and derived tables", () => {
  let dir: string;
  let vault: Vault;
  let derived: DerivedStore;

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "facts-"));
    vault = new Vault(join(dir, "vault"), "Europe/London");
    derived = new DerivedStore(join(dir, "derived"));
  });
  afterEach(() => rm(dir, { recursive: true, force: true }));

  test("reads a day's facts and rereads them once a file changes", async () => {
    const reader = new FactReader(vault, derived);
    await Bun.write(join(vault.root, "daily/2026/2026-11-11.md"), "---\nsteps: 4000\n---\n");
    await derived.write("nights", "2026-11-12", { bed_ts: BED });

    const before = await reader.facts("2026-11-11");
    await Bun.write(join(vault.root, "daily/2026/2026-11-11.md"), "---\nsteps: 9000\n---\n");
    const after = await reader.facts("2026-11-11");

    expect(before).toEqual({ steps: 4000, lights_out: afterNoon(23 * 60 + 12) });
    expect(after.steps).toBe(9000);
  });

  test("auto habits tick themselves, and a hand tick still counts", async () => {
    const habits = new HabitStore(vault);
    await habits.create({
      name: "Steps",
      schedule: { kind: "daily" },
      auto: "steps ≥ 8000",
      since: "2026-11-09",
    });
    for (const [date, steps] of [
      ["2026-11-09", 9000],
      ["2026-11-10", 2000],
      ["2026-11-11", 8500],
    ] as const) {
      await Bun.write(join(vault.root, `daily/2026/${date}.md`), `---\nsteps: ${steps}\n---\n`);
    }
    await habits.mark("steps", "2026-11-10", true);

    const facts = await new FactReader(vault, derived).range("2026-11-09", "2026-11-12");
    const [steps] = await habits.stats("2026-11-12", autoMarker(facts, "2026-11-12"));

    expect(steps?.stats).toMatchObject({ streak: 3, recent: { done: 3, of: 3 } });
  });

  test("a habit's rule must parse", async () => {
    const habits = new HabitStore(vault);

    const bad = habits.create({ name: "Steps", schedule: { kind: "daily" }, auto: "steps lots" });

    await expect(bad).rejects.toBeInstanceOf(InvalidHabit);
  });
});
