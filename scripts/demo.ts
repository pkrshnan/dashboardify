// Serves the web app with made-up data, for working on the UI without a vault or a strap:
//   bun run demo   then open http://localhost:8788 and sign in with "demo-token-0123456789"
// It writes a temporary vault and a year of computed health rows, and runs the calendar against
// the in-memory iCloud the tests use, so the capture box can add, show and undo real events.

import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CalendarAccounts } from "../src/calendar/accounts";
import { EventCache } from "../src/calendar/cache";
import { CalDavClient } from "../src/calendar/caldav";
import { writeEvent } from "../src/calendar/ical";
import { cacheSource } from "../src/calendar/source";
import { CalendarSync } from "../src/calendar/sync";
import { DerivedStore } from "../src/health/derived-store";
import type { Category } from "../src/home/types";
import { Photon } from "../src/places/photon";
import { CalendarAccountService, type ConnectCalDav } from "../src/server/api/calendar-accounts";
import { createApp } from "../src/server/app";
import type { Config } from "../src/server/config";
import { GeneralSettings } from "../src/settings/core";
import { DeviceStore } from "../src/settings/devices";
import { loadKey } from "../src/settings/key";
import { SecretBox } from "../src/settings/secret-box";
import { SettingsStore } from "../src/settings/store";
import { FakeCalDav } from "../test/calendar/fake-caldav";
import { DISHOOM, FakePhoton } from "../test/places/fake-photon";
import homepage from "../web/index.html";

/** Which demo calendar holds each category's events. */
const CALENDAR_FOR: Record<Category, string> = {
  work: "work",
  focus: "work",
  fitness: "fitness",
  personal: "home",
};

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
  dataPath: join(root, "data"),
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
const settings = await SettingsStore.open(
  config.dataPath,
  new SecretBox(await loadKey({ dataPath: config.dataPath })),
);
const devices = new DeviceStore(settings);
devices.add("Demo", TOKEN);
const calendars = await demoCalendars();
const app = createApp(config, {
  devices,
  now,
  calendar: cacheSource(calendars.cache, calendars.accounts),
  settings: {
    general: new GeneralSettings(settings),
    devices,
    envChange: {},
    envNames: [],
    calendars,
    places: demoPlaces(),
  },
});
// DEMO_DEV=0 serves the app without hot reload. Bun's dev server refuses hosts other than
// localhost, so the demo behind a tunnel on CI needs it.
Bun.serve({
  port: config.port,
  routes: { "/": homepage },
  fetch: app.fetch,
  development: process.env.DEMO_DEV !== "0",
});
console.log(`demo on http://localhost:${config.port}, token ${TOKEN}`);

/**
 * Place search from a few London places, so the demo works offline. DEMO_PLACES=photon asks the
 * real Photon server instead.
 */
function demoPlaces(): Photon {
  if (process.env.DEMO_PLACES === "photon") {
    return new Photon();
  }
  const london = { city: "London", country: "United Kingdom", countrycode: "GB" };
  const server = new FakePhoton([
    DISHOOM,
    { name: "London", country: "United Kingdom", countrycode: "GB", lat: 51.5074, lon: -0.1278 },
    {
      ...london,
      name: "British Library",
      street: "Euston Road",
      housenumber: "96",
      lat: 51.5299,
      lon: -0.1277,
    },
    { ...london, name: "Barbican Centre", street: "Silk Street", lat: 51.5202, lon: -0.0938 },
    {
      ...london,
      name: "Monmouth Coffee",
      street: "Park Street",
      housenumber: "2",
      lat: 51.5054,
      lon: -0.0911,
    },
  ]);
  return new Photon("https://photon.demo", server.fetch);
}

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

type Spec = [number, number, number, string, Category, string?, string?];

/**
 * The fake iCloud, seeded with this week and a few past weeks (so the calendar guess has history),
 * an account already connected, and the sync loop running every 30 seconds.
 */
async function demoCalendars() {
  const server = seedServer();
  const accounts = new CalendarAccounts(settings);
  const connect: ConnectCalDav = (account) =>
    new CalDavClient({ ...account, allowedDomains: ["icloud.com"] }, server.fetch);
  await new CalendarAccountService(accounts, connect).createCalendarAccount({
    calendarAccount: { username: server.username, password: server.password },
  });
  const cache = await EventCache.open(config.dataPath);
  const sync = new CalendarSync({ accounts, cache, connect, feedFetch, timeZone: TIME_ZONE });
  await sync.tick();
  sync.start(30_000);
  return { accounts, connect, cache, sync, feedFetch };
}

/**
 * Calendar links in the demo: any https://calendar.example.com/… link is a small work
 * calendar, so "Add calendar link" can be tried without the network. Anything else is refused.
 */
async function feedFetch(request: Request): Promise<Response> {
  if (new URL(request.url).host !== "calendar.example.com") {
    return new Response("The demo only fetches https://calendar.example.com/ links.", {
      status: 404,
    });
  }
  const events = [
    writeEvent({
      uid: "feed-1",
      title: "Quarterly planning",
      start: new Date(at(1, 14)),
      end: new Date(at(1, 15.5)),
      timeZone: TIME_ZONE,
      now: new Date(),
    }),
    writeEvent({
      uid: "feed-2",
      title: "All hands",
      start: new Date(at(3, 11)),
      end: new Date(at(3, 12)),
      timeZone: TIME_ZONE,
      now: new Date(),
    }),
  ];
  // Join the two VCALENDARs' events into one feed, as a published calendar sends them.
  const vevents = events.map((ics) => /BEGIN:VEVENT[\s\S]*END:VEVENT\r\n/.exec(ics)?.[0] ?? "");
  const head = events[0]?.split("BEGIN:VEVENT")[0] ?? "";
  return new Response(
    `${head.replace("VERSION:2.0", "VERSION:2.0\r\nX-WR-CALNAME:Acme work")}${vevents.join("")}END:VCALENDAR\r\n`,
  );
}

function seedServer(): FakeCalDav {
  const server = new FakeCalDav([
    { id: "home", displayName: "Personal" },
    { id: "work", displayName: "Work" },
    { id: "fitness", displayName: "Fitness" },
    { id: "dinners", displayName: "Dinners with Alex", writable: false },
  ]);
  const specs: Spec[] = [
    [0, 8, 8.87, "Gym, lower body", "fitness", "Strain 5.1 · peak 158"],
    [0, 10, 10.25, "Standup", "work", "Video call", "https://meet.example.com/standup"],
    [0, 12.5, 13.25, "Lunch with Priya", "work", "Café on Albert St · ask about Lisbon"],
    [0, 14, 15, "Design review", "work", "Room 4B · Ana, Jordan, Sam K"],
    [0, 17.5, 18.25, "Physio", "fitness", "Northside Clinic · shoulder"],
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
    // History for the calendar guess: physio is on Fitness, so "Physio Fri 3pm" goes there.
    [-7, 17.5, 18.25, "Physio", "fitness"],
    [-14, 17.5, 18.25, "Physio", "fitness"],
    [-21, 17.5, 18.25, "Physio", "fitness"],
  ];
  specs.forEach(([offset, from, to, title, category, location, url], i) => {
    const ics = writeEvent({
      uid: `demo-${i}@dashboardify`,
      title,
      start: new Date(at(offset, from)),
      end: new Date(at(offset, to)),
      timeZone: TIME_ZONE,
      location,
      url,
      now: new Date(),
    });
    server.putEvent(CALENDAR_FOR[category], `demo-${i}.ics`, ics);
  });
  // A shared, read-only calendar with a dinner at a located place (so it links to Apple Maps), a
  // birthday today and a long weekend away as all-day events.
  server.putEvent("dinners", "dinner.ics", dinnerAtDishoom());
  server.putEvent("home", "birthday.ics", allDay("birthday", "Mum's birthday", day(0), day(1)));
  server.putEvent("home", "lisbon.ics", allDay("lisbon", "Lisbon", day(4), day(7)));
  return server;
}

/** Tonight's dinner, at a place with coordinates, as Apple Calendar would write it. */
function dinnerAtDishoom(): string {
  return writeEvent({
    uid: "dinner",
    title: "Dinner with Sam",
    start: new Date(at(0, 19)),
    end: new Date(at(0, 21)),
    timeZone: TIME_ZONE,
    place: {
      name: "Dishoom",
      address: "7 Boundary Street, London",
      latitude: DISHOOM.lat,
      longitude: DISHOOM.lon,
    },
    now: new Date(),
  });
}

function allDay(uid: string, title: string, first: string, after: string): string {
  const compact = (date: string) => date.replaceAll("-", "");
  return [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "BEGIN:VEVENT",
    `UID:${uid}`,
    "DTSTAMP:20260101T000000Z",
    `DTSTART;VALUE=DATE:${compact(first)}`,
    `DTEND;VALUE=DATE:${compact(after)}`,
    `SUMMARY:${title}`,
    "END:VEVENT",
    "END:VCALENDAR",
    "",
  ].join("\r\n");
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
