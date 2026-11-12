import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { DerivedStore } from "../../../src/health/derived-store";
import { useApi } from "./helpers";

describe("home API", () => {
  const api = useApi();

  test("returns the computed home resource with protobuf date fields", async () => {
    const response = await api.call("/v1/home");

    expect(response.status).toBe(200);
    expect(response.body.name).toBe("home");
    expect(response.body.date).toEqual({ year: 2026, month: 11, day: 3 });
    expect(response.body.timeZone).toBe("UTC");
    expect(response.body.generateTime).toBe("2026-11-03T12:00:00Z");
  });

  test("reports when strap data last arrived", async () => {
    const before = await api.call("/v1/home");
    await api.call("/v1/streams/heart_rate:mergeSamples", "POST", {
      day: { year: 2026, month: 11, day: 3 },
      timestamps: ["1793664000000", "1793664060000"],
      columns: [{ name: "bpm", numbers: { values: [60, 61] } }],
    });

    const after = await api.call("/v1/home");

    expect(before.body.healthSync).toBeUndefined();
    expect(after.body.healthSync.latestSampleTime).toBe("2026-11-03T00:01:00Z");
    expect(after.body.healthSync.uploadTime).toBeString();
  });

  test("reports the strap's latest battery", async () => {
    await api.call("/v1/streams/battery:mergeSamples", "POST", {
      day: { year: 2026, month: 11, day: 3 },
      timestamps: ["1793664000000", "1793667600000"],
      columns: [
        { name: "pct", numbers: { values: [24.3, 23.7] } },
        { name: "charging", missingRows: [0], numbers: { values: [0, 1] } },
      ],
    });

    const response = await api.call("/v1/home");

    expect(response.body.healthSync.battery).toEqual({
      percent: 23.7,
      charging: true,
      reportTime: "2026-11-03T01:00:00Z",
    });
  });
});

describe("home API as of a past day", () => {
  const api = useApi();
  const metric = (body: { metrics: { key: string }[] }, key: string) =>
    body.metrics.find((m) => m.key === key) as unknown as {
      value?: string;
      lastDate: unknown;
      dailyValues: number[];
    };
  const asOf = (date: string) => {
    const [year, month, day] = date.split("-").map(Number);
    return `/v1/home?asOfDate.year=${year}&asOfDate.month=${month}&asOfDate.day=${day}`;
  };

  test("ends every metric on that day, nights and days alike", async () => {
    const derived = new DerivedStore(join(api.dir, "derived"));
    await derived.write("nights", "2026-10-31", { rmssd_ms: 48 });
    await derived.write("days", "2026-10-31", { recovery_pct: 71 });
    await derived.write("nights", "2026-11-03", { rmssd_ms: 60 });

    const past = await api.call(asOf("2026-10-31"));
    const now = await api.call("/v1/home");

    expect(past.status).toBe(200);
    expect(past.body.date).toEqual({ year: 2026, month: 11, day: 3 });
    for (const key of ["hrv", "recovery"]) {
      expect(metric(past.body, key).lastDate).toEqual({ year: 2026, month: 10, day: 31 });
    }
    expect(metric(past.body, "hrv").value).toBe("48");
    expect(metric(past.body, "hrv").dailyValues.at(-1)).toBe(48);
    expect(metric(past.body, "recovery").value).toBe("71");
    expect(metric(now.body, "hrv").value).toBe("60");
    expect(metric(now.body, "hrv").lastDate).toEqual({ year: 2026, month: 11, day: 3 });
  });

  test("a future day is today", async () => {
    const response = await api.call(asOf("2026-11-20"));

    expect(response.status).toBe(200);
    expect(metric(response.body, "hrv").lastDate).toEqual({ year: 2026, month: 11, day: 3 });
  });

  test("a day that doesn't exist is refused", async () => {
    const response = await api.call(asOf("2026-02-30"));

    expect(response.status).toBe(400);
  });
});

describe("home API with a calendar", () => {
  const api = useApi({
    calendar: {
      events: () =>
        Promise.resolve([
          {
            title: "Standup",
            start: Date.parse("2026-11-03T13:00:00Z"),
            end: Date.parse("2026-11-03T13:15:00Z"),
            category: "work",
            event: "events/abcdefghijklmnop",
            calendar: "calendarAccounts/icloud/calendars/work",
            writable: true,
          },
          {
            title: "Lisbon",
            start: Date.parse("2026-11-04T00:00:00Z"),
            end: Date.parse("2026-11-06T00:00:00Z"),
            category: "personal",
            allDay: true,
            startDate: "2026-11-04",
            endDate: "2026-11-06",
          },
        ]),
      status: () => ({ lastSyncTime: "2026-11-03T11:58:00Z", hasErrors: false }),
      hints: () => ({
        calendars: [
          { name: "calendarAccounts/icloud/calendars/work", displayName: "Work", category: "work" },
        ],
        defaultCalendar: "calendarAccounts/icloud/calendars/work",
        rules: [],
        titles: [
          {
            titleKey: "standup",
            calendar: "calendarAccounts/icloud/calendars/work",
            count: 12,
            lastTime: "2026-11-02T13:00:00Z",
          },
        ],
      }),
    },
  });

  test("returns events with their calendar, all-day markers, sync time and hints", async () => {
    const { status, body } = await api.call("/v1/home");
    const [today, tomorrow] = body.days;

    expect(status).toBe(200);
    expect(today.events[0]).toMatchObject({
      title: "Standup",
      event: "events/abcdefghijklmnop",
      calendar: "calendarAccounts/icloud/calendars/work",
      writable: true,
    });
    expect(tomorrow.events).toBeUndefined();
    expect(tomorrow.allDayEvents[0]).toMatchObject({ title: "Lisbon", allDay: true });
    expect(body.calendarSync).toEqual({ lastSyncTime: "2026-11-03T11:58:00Z" });
    expect(body.captureHints.titles).toEqual([
      {
        titleKey: "standup",
        calendar: "calendarAccounts/icloud/calendars/work",
        count: 12,
        lastTime: "2026-11-02T13:00:00Z",
      },
    ]);
  });
});

describe("home API without a calendar", () => {
  const api = useApi();

  test("leaves out the calendar sync time and hints", async () => {
    const { body } = await api.call("/v1/home");

    expect(body.calendarSync).toBeUndefined();
    expect(body.captureHints).toBeUndefined();
  });
});
