import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DerivedStore } from "../../src/health/derived-store";
import type { HomeView } from "../../src/home/types";
import { createApp } from "../../src/server/app";
import type { Config } from "../../src/server/config";

const TOKEN = "test-token-0123456789";
const TZ = "Europe/London";
let dir: string;
let config: Config;

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), "home-"));
  config = {
    vaultPath: join(dir, "vault"),
    port: 0,
    timeZone: TZ,
    healthRawPath: join(dir, "raw"),
    healthDerivedPath: join(dir, "derived"),
    tasksInbox: "Inbox.md",
    tokens: new Map([["mac", TOKEN]]),
  };
  await Bun.write(
    join(config.vaultPath, "Inbox.md"),
    "- [ ] Renew lease 📅 2026-10-31\n- [ ] Call Mum ⏰ 18:30 📅 2026-11-03\n",
  );
});
afterEach(() => rm(dir, { recursive: true, force: true }));

const NOW = new Date("2026-11-03T09:12:00Z");
const ninePastNine = () => NOW;

async function getHome(app: ReturnType<typeof createApp>): Promise<HomeView> {
  const res = await app.request("/api/home", { headers: { authorization: `Bearer ${TOKEN}` } });
  expect(res.status).toBe(200);
  return (await res.json()) as HomeView;
}

describe("GET /api/home", () => {
  test("needs a token", async () => {
    const app = createApp(config, { now: ninePastNine });
    expect((await app.request("/api/home")).status).toBe(401);
  });

  test("gathers the sentence, next event, days, tasks and health", async () => {
    const derived = new DerivedStore(config.healthDerivedPath);
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
    const view = await getHome(createApp(config, { now: ninePastNine, calendar }));

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
      "sleepScore",
      "asleep",
      "strain",
      "steps",
      "zone2",
      "breathing",
      "skinTemp",
    ]);
  });

  test("works with no health data and no calendar", async () => {
    const view = await getHome(createApp(config, { now: ninePastNine }));
    expect(view.next).toBeNull();
    expect(view.health.every((m) => m.value === null)).toBe(true);
    expect(view.days).toHaveLength(7);
  });

  test("picks up a rewritten day without a restart", async () => {
    const app = createApp(config, { now: ninePastNine });
    const derived = new DerivedStore(config.healthDerivedPath);
    await derived.write("days", "2026-11-03", { recovery_pct: 50 });
    expect((await getHome(app)).health[0]?.value).toBe("50");
    await Bun.sleep(5);
    await derived.write("days", "2026-11-03", { recovery_pct: 70 });
    expect((await getHome(app)).health[0]?.value).toBe("70");
  });
});

describe("web files", () => {
  test("serves the manifest's icons without a token", async () => {
    const res = await createApp(config).request("/icon.svg");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/svg+xml");
  });
});
