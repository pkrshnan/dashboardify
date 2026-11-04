import { defined } from "../../defined";
import { appendToSection, editNote } from "../../vault/markdown";
import { shortHash } from "../../vault/task-store";
import { isIsoDate, localDate, localTime } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import { invalidArgument, requireText } from "./errors";
import { paginate } from "./pagination";
import type { ApiRequests } from "./requests";
/** Appends and reads timestamped entries under the daily Journal heading. */
export class JournalService {
  constructor(
    private readonly vault: Vault,
    private readonly now: () => Date,
  ) {}

  private readonly dayOf = (name: string) => {
    const match = /^days\/(\d{4}-\d{2}-\d{2})(?:\/checkin)?$/.exec(name ?? "");
    if (!(match && isIsoDate(match[1]))) {
      invalidArgument("invalid day name");
    }
    return defined(match?.[1]);
  };

  private readonly entries = async (day: string, includeMarkers = false) => {
    const note = await this.vault.readDaily(day);
    const section = note?.body.split(/^## Journal\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    const counts = new Map<string, number>();
    return [...section.matchAll(/^- (\d{2}:\d{2}) (.*(?:\n {2}.*)*)/gm)].map((match) => {
      const key = defined(match[1]).replace(":", "");
      const occurrence = (counts.get(key) ?? 0) + 1;
      counts.set(key, occurrence);
      return {
        name: `days/${day}/journalEntries/${key}-${occurrence}`,
        text: (includeMarkers
          ? defined(match[2])
          : defined(match[2]).replace(/ <!-- request:[a-f0-9]+ -->$/, "")
        ).replace(/\n {2}/g, "\n"),
        entryTime: Temporal.PlainDateTime.from(`${day}T${match[1]}`)
          .toZonedDateTime(this.vault.timeZone)
          .toInstant()
          .toString(),
      };
    });
  };

  listJournalEntries = async (request: ApiRequests["listJournalEntries"]) => {
    const resultPage = paginate(await this.entries(this.dayOf(request.parent)), request);
    return { journalEntries: resultPage.items, nextPageToken: resultPage.nextPageToken };
  };

  createJournalEntry = async (request: ApiRequests["createJournalEntry"]) => {
    const day = this.dayOf(request.parent);
    const input = request.journalEntry ?? {};
    const at = journalTimestamp(input.entryTime, day, this.now(), this.vault.timeZone);
    const value = requireText(input.text);
    const marker = request.requestId ? ` <!-- request:${shortHash(request.requestId)} -->` : "";
    const path = this.vault.dailyPath(day);
    const time = localTime(at, this.vault.timeZone);
    await this.vault.update(path, (source) => {
      if (marker && source?.includes(marker)) {
        return null;
      }
      return editNote(
        source,
        { frontmatter: { date: day, tags: ["daily"] }, body: `# ${day}\n\n## Journal\n` },
        (note) => {
          const line = `- ${time} ${value.trim().replace(/\r?\n/g, "\n  ")}${marker}\n`;
          note.body = appendToSection(note.body, "Journal", line);
          return note;
        },
      );
    });
    const all = await this.entries(day, true);
    const entry = all.find((entry) => marker && entry.text.includes(marker)) ?? defined(all.at(-1));
    return { ...entry, text: entry.text.replace(/ <!-- request:[a-f0-9]+ -->$/, "") };
  };
}

function journalTimestamp(
  value: string | undefined,
  day: string,
  now: Date,
  timeZone: string,
): Date {
  const localTimestamp = `${day}T${localTime(now, timeZone)}`;
  const timestamp = value
    ? new Date(value)
    : new Date(
        Temporal.PlainDateTime.from(localTimestamp).toZonedDateTime(timeZone).epochMilliseconds,
      );
  if (Number.isNaN(timestamp.getTime()) || localDate(timestamp, timeZone) !== day) {
    invalidArgument("entry_time must fall in parent day");
  }
  return timestamp;
}
