import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DerivedStore } from "../../src/health/derived-store";
import { RawStore } from "../../src/health/raw-store";
import { type CalendarSource, noCalendar } from "../../src/home/calendar";
import { type HomeDeps, homeView, storeHomeDeps } from "../../src/home/home";
import type { HomeView } from "../../src/home/types";
import { TaskStore } from "../../src/vault/task-store";
import { Vault } from "../../src/vault/vault";

const TZ = "Europe/London";
let dir: string;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "home-"));
  await Bun.write(
    join(dir, "vault", "Inbox.md"),
    "- [ ] Renew lease\n\t- due: 2026-10-31\n- [ ] Call Mum\n\t- due: 2026-11-03 18:30\n",
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const NOW = new Date("2026-11-03T09:12:00Z");
const ninePastNine = () => NOW;

/** The home screen's sources over this test's vault and stores. */
function deps(calendar: CalendarSource = noCalendar): HomeDeps {
  const vault = new Vault(join(dir, "vault"), TZ);
  return storeHomeDeps({
    vault,
    tasks: new TaskStore(vault, "Inbox.md"),
    raw: new RawStore(join(dir, "raw")),
    derived: new DerivedStore(join(dir, "derived")),
    calendar,
    timeZone: TZ,
  });
}

const getHome = (from: HomeDeps): Promise<HomeView> => homeView(from, ninePastNine());

describe("homeView", () => {
  test("gathers the sentence, next event, days, tasks and health", async () => {
    const derived = new DerivedStore(join(dir, "derived"));
    for (let back = 70; back >= 0; back--) {
      const date = Temporal.PlainDate.from("2026-11-03").subtract({ days: back }).toString();
      const recent = back < 7;
      await derived.write("days", date, { recovery_pct: recent ? 40 : 60 + (back % 2) * 10 });
      await derived.write("nights", date, { rmssd_ms: 55, tst_min: 432 });
    }
    const start = Date.parse("2026-11-03T10:00:00Z");
    const calendar = {
      events: () =>
        Promise.resolve([
          {
            title: "Standup",
            start,
            end: start + 15 * 60_000,
            category: "work" as const,
            detail: "Video call",
            url: "https://meet.example.com/x",
          },
        ]),
    };
    const view = await getHome(deps(calendar));

    expect(view.date).toBe("2026-11-03");
    expect(view.sentence).toBe(
      "Standup at 10:00. Recovery is below your usual, so keep today easy. Renew lease is 3 days late.",
    );
    expect(view.next).toEqual({
      title: "Standup",
      start: "10:00",
      detail: "Video call",
      inMin: 48,
      url: "https://meet.example.com/x",
      mapsUrl: null,
    });
    expect(view.days[0]?.reminders.map((r) => r.text)).toEqual(["Call Mum"]);
    expect(view.tasks.map((g) => g.name)).toEqual(["Overdue"]);

    const recovery = view.health.find((m) => m.key === "recovery");
    expect(recovery?.value).toBe("40");
    expect(recovery?.delta).toBe("−38%");
    expect(recovery?.tone).toBe("bad");
    expect(view.health.find((m) => m.key === "asleep")?.value).toBe("7h 12m");
    expect(view.health.map((m) => m.key)).toEqual([
      "recovery",
      "hrv",
      "restingHr",
      "vo2max",
      "sleepScore",
      "asleep",
      "deep",
      "rem",
      "strain",
      "steps",
      "zone2",
      "calories",
      "loadRatio",
      "breathing",
      "skinTemp",
    ]);
  });

  test("lists the habits due today or done today, before 04:00 as yesterday's", async () => {
    await Bun.write(
      join(dir, "vault/Habits.md"),
      [
        "- Read <!-- id:read -->",
        "- Lift <!-- id:lift -->\n\t- schedule: 1 a week",
        "- Floss <!-- id:floss -->\n\t- status: paused",
        "- Gym <!-- id:gym -->\n\t- schedule: Sat",
        "- Swim <!-- id:swim -->\n\t- schedule: 1 a week",
        "",
      ].join("\n"),
    );
    // Swim met its week on Monday, so it isn't due; Lift is done today.
    await Bun.write(join(dir, "vault/Daily/2026/2026-11-02.md"), "---\nhabits: [swim]\n---\n");
    await Bun.write(join(dir, "vault/Daily/2026/2026-11-03.md"), "---\nhabits: [lift]\n---\n");

    const morning = await homeView(deps(), NOW);
    const lateNight = await homeView(deps(), new Date("2026-11-04T02:30:00Z"));

    expect(morning.habits.map((h) => [h.id, h.done, h.day])).toEqual([
      ["read", false, "2026-11-03"],
      ["lift", true, "2026-11-03"],
    ]);
    expect(lateNight.date).toBe("2026-11-04");
    expect(lateNight.habits[0]?.day).toBe("2026-11-03");
  });

  test("works with no health data and no calendar", async () => {
    const view = await getHome(deps());
    expect(view.next).toBeNull();
    expect(view.health.every((m) => m.value === null)).toBe(true);
    expect(view.days).toHaveLength(7);
  });

  test("picks up a rewritten day without a restart", async () => {
    const home = deps();
    const derived = new DerivedStore(join(dir, "derived"));
    await derived.write("days", "2026-11-03", { recovery_pct: 50 });
    expect((await getHome(home)).health[0]?.value).toBe("50");
    await Bun.sleep(5);
    await derived.write("days", "2026-11-03", { recovery_pct: 70 });
    expect((await getHome(home)).health[0]?.value).toBe("70");
  });
});
