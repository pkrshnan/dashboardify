// Serves the web app with made-up data, for working on the UI without a vault or a strap:
//   bun run demo   then open http://localhost:8788 and sign in with "demo-token-0123456789"
// It writes a temporary vault and a year of computed health rows, and fakes the calendar.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DerivedStore } from "../src/health/derived-store";
import type { CalendarEvent, CalendarSource } from "../src/home/calendar";
import { createApp } from "../src/server/app";
import type { Config } from "../src/server/config";
import homepage from "../web/index.html";

const TOKEN = "demo-token-0123456789";
const TIME_ZONE = process.env.TZ_NAME ?? "Europe/London";
const today = Temporal.Now.plainDateISO(TIME_ZONE);
const day = (offset: number) => today.add({ days: offset }).toString();

const root = await mkdtemp(join(tmpdir(), "dashboardify-demo-"));
const config: Config = {
  vaultPath: join(root, "vault"),
  port: Number(process.env.PORT ?? 8788),
  timeZone: TIME_ZONE,
  healthRawPath: join(root, "health-raw"),
  healthDerivedPath: join(root, "health-derived"),
  tasksInbox: "Inbox.md",
  tokens: new Map([["demo", TOKEN]]),
};

await Bun.write(join(config.vaultPath, "Inbox.md"), tasks().join("\n"));
await writeHealth(new DerivedStore(config.healthDerivedPath));

// DEMO_TIME=09:12 pins the server's clock to that time today, for screenshots.
const pinned = process.env.DEMO_TIME?.split(":").map(Number);
const now = pinned ? () => new Date(at(0, (pinned[0] ?? 0) + (pinned[1] ?? 0) / 60)) : undefined;
// DEMO_SYNC_MIN=300 makes the strap data that many minutes old (default 12), to see it lag.
const syncAt = (now?.() ?? new Date()).getTime() - Number(process.env.DEMO_SYNC_MIN ?? 12) * 60_000;
await Bun.write(
  join(config.healthRawPath, "sync.json"),
  JSON.stringify({ latestSampleTs: syncAt, uploadTs: syncAt + 60_000 }),
);
const app = createApp(config, { calendar: fakeCalendar(), now });
Bun.serve({ port: config.port, routes: { "/": homepage }, fetch: app.fetch, development: true });
console.log(`demo on http://localhost:${config.port}, token ${TOKEN}`);

function tasks(): string[] {
  return [
    `- [x] Take vitamin D ⏰ 09:00 📅 ${day(0)}`,
    `- [ ] Leave for physio ⏰ 17:05 📅 ${day(0)}`,
    `- [ ] Call Mum ⏰ 18:30 📅 ${day(0)}`,
    `- [ ] Charge the strap ⏰ 21:30 📅 ${day(0)}`,
    `- [ ] Renew lease 📅 ${day(-3)}`,
    `- [ ] Upload insurance receipt 📅 ${day(0)}`,
    `- [ ] Order contact lenses 📅 ${day(2)}`,
    `- [ ] Prep 1:1 notes ⏰ 15:00 📅 ${day(3)}`,
    `- [ ] Book December flights 📅 ${day(5)}`,
    "- [ ] Fix bike brakes",
    "",
  ];
}

function at(offset: number, hour: number): number {
  const plainTime = { hour: Math.floor(hour), minute: Math.round((hour % 1) * 60) };
  return today.add({ days: offset }).toZonedDateTime({ timeZone: TIME_ZONE, plainTime })
    .epochMilliseconds;
}

type Spec = [number, number, number, string, CalendarEvent["category"], string?, string?];

function fakeCalendar(): CalendarSource {
  const specs: Spec[] = [
    [0, 8, 8.87, "Gym, lower body", "fitness", "Strain 5.1 · peak 158"],
    [0, 10, 10.25, "Standup", "work", "Video call", "https://meet.example.com/standup"],
    [0, 12.5, 13.25, "Lunch with Priya", "work", "Café on Albert St · ask about Lisbon"],
    [0, 14, 15, "Design review", "work", "Room 4B · Ana, Jordan, Sam K"],
    [0, 17.5, 18.25, "Physio", "fitness", "Northside Clinic · shoulder"],
    [0, 19, 21, "Dinner with Sam", "personal", "Sam's place · bring the book"],
    [1, 10, 10.25, "Standup", "work"],
    [1, 13, 14.5, "Focus block", "focus"],
    [1, 18, 19, "Climbing", "fitness"],
    [2, 7.5, 8.4, "Gym", "fitness"],
    [2, 16, 17, "Interview", "work"],
    [3, 16, 16.5, "1:1", "work"],
    [3, 19.5, 22, "Film night", "personal"],
    [4, 8, 9.5, "Long run", "fitness"],
    [5, 11, 13, "Brunch with family", "personal"],
    [6, 15, 16, "Planning", "work"],
  ];
  const events = specs.map(([offset, from, to, title, category, detail, url]) => ({
    title,
    start: at(offset, from),
    end: at(offset, to),
    category,
    detail,
    url,
  }));
  return {
    events: (from, to) => Promise.resolve(events.filter((e) => e.start < to && e.end > from)),
  };
}

/** A year of plausible nights and days, with this week a little worse than usual. */
async function writeHealth(store: DerivedStore): Promise<void> {
  let seed = 7;
  const noise = () => {
    seed = (seed * 9301 + 49297) % 233280;
    return seed / 233280 - 0.5;
  };
  for (let back = 380; back >= 0; back--) {
    const date = day(-back);
    const recent = back < 7 ? 1 : 0;
    // Today's activity is a running total, part way through the day.
    const sofar = back === 0 ? 0.4 : 1;
    const wave = Math.sin(back / 40);
    await store.write("nights", date, {
      date,
      sleep_score: 76 + 8 * noise() * 2 + 2 * wave,
      tst_min: 420 + 40 * noise() * 2,
      rhr_bpm: 50 + 2 * noise() * 2 + recent * 1.5,
      rmssd_ms: 58 + 7 * noise() * 2 - recent * 5,
      resp_rate_bpm: 14.5 + 0.4 * noise() * 2,
      skin_temp_c: 33.4 + 0.3 * noise() * 2 + recent * 0.1,
    });
    await store.write("days", date, {
      date,
      recovery_pct: back === 0 ? 62 : 68 + 11 * noise() * 2 - recent * 10,
      strain: (11 + 3 * noise() * 2) * sofar,
      steps: (8500 + 2400 * noise() * 2) * sofar,
      zone2_min: (20 + 8 * noise() * 2) * sofar,
      zone3_min: (10 + 5 * noise() * 2) * sofar,
      zone4_min: 4 * sofar,
      zone5_min: 1 * sofar,
    });
  }
}
