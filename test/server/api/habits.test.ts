import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DerivedStore } from "../../../src/health/derived-store";
import { useApi } from "./helpers";

// The test clock is 12:00 UTC on Tuesday 3 Nov 2026.
const DAILY = { kind: "KIND_DAILY" };

describe("HabitService", () => {
  const api = useApi();

  const create = (habit: object) => api.call("/v1/habits", "POST", habit);
  const note = (date: string, text: string) =>
    Bun.write(join(api.dir, `vault/Daily/2026/${date}.md`), text);

  test("creates a habit in Habits.md, starting today, and a retry returns it", async () => {
    const first = await create({ displayName: "Meditate", schedule: DAILY });
    const again = await create({ displayName: "meditate", schedule: DAILY });

    expect(first.status).toBe(200);
    expect(first.body).toMatchObject({
      name: "habits/meditate",
      displayName: "Meditate",
      schedule: DAILY,
      color: "#BF5AF2",
      state: "STATE_ACTIVE",
      startDate: { year: 2026, month: 11, day: 3 },
      progress: { unit: "UNIT_DAY", due: true },
    });
    expect(again.body.name).toBe("habits/meditate");
    expect(await api.vaultFile("Habits.md")).toBe(
      "# Habits\n\n- Meditate <!-- id:meditate -->\n\t- schedule: daily\n\t- colour: BF5AF2\n\t- since: 2026-11-03\n",
    );
  });

  test("reads schedules, rules and colours both ways", async () => {
    const { body } = await create({
      displayName: "Lights out",
      schedule: { kind: "KIND_DAYS", days: ["SUNDAY", "MONDAY", "TUESDAY"] },
      auto: "lights_out ≤ 23:30",
      color: "#7d7aff",
    });

    expect(body.schedule).toEqual({ kind: "KIND_DAYS", days: ["MONDAY", "TUESDAY", "SUNDAY"] });
    expect(body.auto).toBe("lights_out ≤ 23:30");
    expect(body.color).toBe("#7D7AFF");
    expect(await api.vaultFile("Habits.md")).toContain(
      "- Lights out <!-- id:lights-out -->\n\t- schedule: Mon Tue Sun\n\t- auto: lights_out ≤ 23:30\n\t- colour: 7D7AFF\n",
    );
  });

  test("refuses a bad schedule, rule or name", async () => {
    const bad = [
      { displayName: "Lift", schedule: { kind: "KIND_WEEKLY", timesPerWeek: 0 } },
      { displayName: "Floss", schedule: { kind: "KIND_DAYS" } },
      { displayName: "Steps", schedule: DAILY, auto: "steps lots" },
      { displayName: "a <!-- b", schedule: DAILY },
    ];
    for (const habit of bad) {
      expect((await create(habit)).status).toBe(400);
    }
  });

  test("ticks today by hand, once however often it's sent, and unticks", async () => {
    await create({ displayName: "Read", schedule: DAILY });

    const ticked = await api.call("/v1/habits/read:mark", "POST", { done: true });
    await api.call("/v1/habits/read:mark", "POST", { done: true });
    const note = await api.vaultFile("Daily/2026/2026-11-03.md");
    const unticked = await api.call("/v1/habits/read:mark", "POST", { done: false });

    expect(ticked.body.progress).toMatchObject({ done: true, streak: 1 });
    expect(note).toContain("habits:\n  - read\n");
    expect(unticked.body.progress.done).toBeUndefined();
  });

  test("fixes a past day, which can move the start back, but not a future one", async () => {
    await create({ displayName: "Read", schedule: DAILY });

    const fixed = await api.call("/v1/habits/read:mark", "POST", {
      day: { year: 2026, month: 11, day: 2 },
      done: true,
    });
    const future = await api.call("/v1/habits/read:mark", "POST", {
      day: { year: 2026, month: 11, day: 4 },
      done: true,
    });

    expect(fixed.body.startDate).toEqual({ year: 2026, month: 11, day: 2 });
    expect(fixed.body.progress.streak).toBe(1);
    expect(future.status).toBe(400);
    expect((await api.call("/v1/habits/nope:mark", "POST", { done: true })).status).toBe(404);
  });

  test("updates with a mask and refuses a stale etag", async () => {
    const { body } = await create({ displayName: "Lift", schedule: DAILY });

    const updated = await api.call("/v1/habits/lift?update_mask=schedule,state", "PATCH", {
      name: "habits/lift",
      schedule: { kind: "KIND_WEEKLY", timesPerWeek: 3 },
      state: "STATE_PAUSED",
    });
    const stale = await api.call(`/v1/habits/lift?etag=${body.etag}`, "PATCH", {
      name: "habits/lift",
      displayName: "Lifting",
    });

    expect(updated.body).toMatchObject({
      displayName: "Lift",
      schedule: { kind: "KIND_WEEKLY", timesPerWeek: 3 },
      state: "STATE_PAUSED",
      progress: { unit: "UNIT_WEEK" },
    });
    expect(stale.status).toBe(409);
    expect((await api.call("/v1/habits/nope", "PATCH", { displayName: "x" })).status).toBe(404);
  });

  test("lists habits in note order, leaving out archived ones unless asked", async () => {
    await create({ displayName: "Read", schedule: DAILY });
    await create({ displayName: "Floss", schedule: DAILY });
    await api.call("/v1/habits/floss", "PATCH", { name: "habits/floss", state: "STATE_ARCHIVED" });

    const shown = await api.call("/v1/habits");
    const all = await api.call("/v1/habits?show_archived=true");

    expect(shown.body.habits.map((h: { name: string }) => h.name)).toEqual(["habits/read"]);
    expect(all.body.habits).toHaveLength(2);
    expect((await api.call("/v1/habits/read")).body.displayName).toBe("Read");
    expect((await api.call("/v1/habits/nope")).status).toBe(404);
  });

  test("auto habits tick from the day's facts; each day says how it went", async () => {
    await create({ displayName: "Steps", schedule: DAILY, auto: "steps ≥ 8000" });
    await api.call("/v1/habits/steps:mark", "POST", {
      day: { year: 2026, month: 10, day: 31 },
      done: true,
    });
    await note("2026-11-01", "---\nsteps: 9100\n---\n");
    await note("2026-11-02", "---\nsteps: 3000\n---\n");
    await note("2026-11-03", "---\nsteps: 2000\n---\n");

    const { body } = await api.call(
      "/v1/habits/steps/days?start_date.year=2026&start_date.month=10&start_date.day=30",
    );
    const marks = body.days.map((d: { mark: string; ticked?: boolean }) => [d.mark, !!d.ticked]);

    expect(marks).toEqual([
      ["MARK_BEFORE_START", false],
      ["MARK_DONE", true],
      ["MARK_DONE", false],
      ["MARK_OPEN", false],
      ["MARK_PENDING", false],
    ]);
  });

  test("a night fact counts for the evening it started", async () => {
    await create({ displayName: "Lights out", schedule: DAILY, auto: "lights_out ≤ 23:30" });
    const derived = new DerivedStore(join(api.dir, "derived"));
    await derived.write("nights", "2026-11-03", { bed_ts: Date.parse("2026-11-02T23:05:00Z") });
    await api.call("/v1/habits/lights-out:mark", "POST", {
      day: { year: 2026, month: 11, day: 1 },
      done: true,
    });

    const { body } = await api.call("/v1/habits/lights-out");

    expect(body.progress.streak).toBe(2);
    expect(body.progress.atRisk).toBeUndefined();
  });

  test("lists the facts a rule can use, with their defaults", async () => {
    const { body } = await api.call("/v1/habitFacts");

    expect(body.facts[0]).toEqual({
      name: "steps",
      label: "Steps",
      kind: "count",
      defaultRule: "steps ≥ 8000",
    });
    expect(body.facts.find((f: { name: string }) => f.name === "lights_out")).toMatchObject({
      night: true,
      defaultRule: "lights_out ≤ 23:30",
    });
  });

  test("refuses a day range that's backwards or too long", async () => {
    await create({ displayName: "Read", schedule: DAILY });

    const backwards = await api.call(
      "/v1/habits/read/days?start_date.year=2026&start_date.month=11&start_date.day=5",
    );
    const long = await api.call(
      "/v1/habits/read/days?start_date.year=2025&start_date.month=1&start_date.day=1",
    );

    expect(backwards.status).toBe(400);
    expect(long.status).toBe(400);
  });
});
