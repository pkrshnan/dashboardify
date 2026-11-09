// Today's events in the daily note, as a machine-owned `<!-- cc:agenda -->` block, so the note
// reads as a record of the day. It is rewritten only when today's events change, and nothing
// outside the block is touched.

import { hhmm, instantAt, isoDate, wallClock } from "../capture/zone";
import type { CalendarEvent, CalendarSource } from "../home/calendar";
import type { Vault } from "../vault/vault";

const DAY_MS = 86_400_000;

/** "## Agenda" then "- All day: Lisbon" and "- 10:00–10:15 Standup" lines, by start. */
export function agendaBlock(events: CalendarEvent[], timeZone: string): string {
  const lines = [...events]
    .sort((a, b) => Number(b.allDay ?? false) - Number(a.allDay ?? false) || a.start - b.start)
    .map((event) => `- ${when(event, timeZone)} ${event.title.replace(/\s+/g, " ").trim()}`);
  return ["## Agenda", ...(lines.length > 0 ? lines : ["Nothing on the calendar."])].join("\n");
}

function when(event: CalendarEvent, timeZone: string): string {
  if (event.allDay) {
    return "All day:";
  }
  const start = wallClock(new Date(event.start), timeZone);
  const end = wallClock(new Date(event.end), timeZone);
  return `${hhmm(start.hour, start.minute)}–${hhmm(end.hour, end.minute)}`;
}

/** Writes today's block after each sync, skipping the write when nothing changed. */
export class AgendaWriter {
  private written = "";

  constructor(
    private readonly vault: Vault,
    private readonly calendar: CalendarSource,
    private readonly timeZone: string,
    private readonly now: () => Date = () => new Date(),
  ) {}

  async write(): Promise<boolean> {
    const now = this.now();
    const today = wallClock(now, this.timeZone);
    const date = isoDate(today);
    const midnight = instantAt({ ...today, hour: 0, minute: 0 }, this.timeZone).getTime();
    const tomorrow = wallClock(new Date(midnight + DAY_MS + 3 * 3_600_000), this.timeZone);
    const next = instantAt({ ...tomorrow, hour: 0, minute: 0 }, this.timeZone).getTime();
    const events = (await this.calendar.events(midnight, next)).filter(
      (e) => !e.allDay || (e.startDate ?? "") <= date,
    );
    const block = agendaBlock(events, this.timeZone);
    if (`${date}\n${block}` === this.written) {
      return false;
    }
    await this.vault.setDailyBlock(date, "agenda", block);
    this.written = `${date}\n${block}`;
    return true;
  }
}
