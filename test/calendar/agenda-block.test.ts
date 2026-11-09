import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { AgendaWriter, agendaBlock } from "../../src/calendar/agenda-block";
import type { CalendarEvent } from "../../src/home/calendar";
import { Vault } from "../../src/vault/vault";

const TZ = "Europe/London";
const at = (iso: string) => new Date(iso).getTime();
const standup: CalendarEvent = {
  title: "Standup",
  start: at("2026-11-10T10:00:00Z"),
  end: at("2026-11-10T10:15:00Z"),
  category: "work",
};
const lunch: CalendarEvent = {
  title: "Lunch  with\\nSam",
  start: at("2026-11-10T12:30:00Z"),
  end: at("2026-11-10T13:30:00Z"),
  category: "personal",
};
const trip: CalendarEvent = {
  title: "Lisbon",
  start: at("2026-11-09T00:00:00Z"),
  end: at("2026-11-12T00:00:00Z"),
  category: "personal",
  allDay: true,
  startDate: "2026-11-09",
  endDate: "2026-11-12",
};

describe("agendaBlock", () => {
  test("lists all-day events first, then the day by start, one line each", () => {
    expect(agendaBlock([lunch, standup, trip], TZ)).toBe(
      "## Agenda\n- All day: Lisbon\n- 10:00–10:15 Standup\n- 12:30–13:30 Lunch with\\nSam",
    );
  });

  test("says so when the day is empty", () => {
    expect(agendaBlock([], TZ)).toBe("## Agenda\nNothing on the calendar.");
  });
});

describe("AgendaWriter", () => {
  let dir: string;
  let vault: Vault;
  let events: CalendarEvent[];
  const now = () => new Date("2026-11-10T08:00:00Z");
  const note = () => Bun.file(join(dir, vault.dailyPath("2026-11-10"))).text();

  beforeEach(async () => {
    dir = await mkdtemp(join(tmpdir(), "agenda-"));
    vault = new Vault(dir, TZ);
    events = [standup];
  });

  afterEach(() => rm(dir, { recursive: true, force: true }));

  test("only the agenda block changes, and only when today's events do", async () => {
    await vault.appendJournal(new Date("2026-11-10T07:30:00Z"), "Slept well");
    await vault.setDailyBlock("2026-11-10", "health", "## Health\nRecovery 62%");
    const writer = new AgendaWriter(vault, { events: () => Promise.resolve(events) }, TZ, now);

    const first = await writer.write();
    const before = await note();
    const again = await writer.write();
    events = [standup, lunch];
    await writer.write();
    const after = await note();

    expect([first, again]).toEqual([true, false]);
    expect(before).toContain(
      "<!-- cc:agenda -->\n## Agenda\n- 10:00–10:15 Standup\n<!-- /cc:agenda -->",
    );
    expect(after.replace(/<!-- cc:agenda -->[\s\S]*<!-- \/cc:agenda -->/, "")).toBe(
      before.replace(/<!-- cc:agenda -->[\s\S]*<!-- \/cc:agenda -->/, ""),
    );
    expect(after).toContain("Slept well");
    expect(after).toContain("## Health\nRecovery 62%");
    expect(after).toContain("- 12:30–13:30");
  });
});
