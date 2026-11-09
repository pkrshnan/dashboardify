// CaptureService: one line in, an event or a task out. The server parses again with its own
// clock and zone, so a tab left open overnight or a Siri Shortcut (with no parser of its own)
// can't write the wrong day. A hand-switched kind and a hand-picked calendar win.

import { chooseCalendar } from "../../capture/choose-calendar";
import { type CaptureKind, type CaptureParse, parseCapture } from "../../capture/parse";
import { taskFields } from "../../capture/task-fields";
import { hhmm, isoDate, wallClock } from "../../capture/zone";
import type { CalendarSource, CaptureHints } from "../../home/calendar";
import { toDateParts, toTimeParts } from "./date-time";
import { failedPrecondition, invalidArgument } from "./errors";

const KINDS: Record<string, CaptureKind | undefined> = {
  CAPTURE_KIND_EVENT: "event",
  CAPTURE_KIND_REMINDER: "reminder",
};

/** The two services a capture ends in. */
export interface CaptureTargets {
  createTask: (request: {
    task: ReturnType<typeof taskFields>;
    requestId?: string;
  }) => Promise<{ name?: string }>;
  createEvent: (request: {
    event: {
      calendar: string;
      title: string;
      startTime: string;
      endTime: string;
      timeZone: string;
    };
    requestId?: string;
  }) => Promise<{ name?: string }>;
}

interface Request {
  text: string;
  kind?: string;
  calendar?: string;
  requestId?: string;
}

export class CaptureService {
  constructor(
    private readonly targets: CaptureTargets,
    private readonly calendar: CalendarSource,
    private readonly timeZone: string,
    private readonly now: () => Date,
  ) {}

  parseCapture = async (request: Request) => this.parseView(this.read(request));

  capture = async (request: Request) => {
    const read = this.read(request);
    const { parse } = read;
    if (parse.kind === "reminder") {
      const task = await this.targets.createTask({
        task: taskFields(parse),
        requestId: request.requestId,
      });
      return {
        parse: this.parseView(read),
        task,
        message: `Added ${parse.title} to Inbox${this.when(parse)}.`,
      };
    }
    if (!read.calendar) {
      failedPrecondition("Connect a calendar in Settings to add events.");
    }
    const event = await this.targets.createEvent({
      event: {
        calendar: read.calendar.calendar,
        title: parse.title,
        startTime: parse.start?.toISOString() ?? "",
        endTime: parse.end?.toISOString() ?? "",
        timeZone: this.timeZone,
      },
      requestId: request.requestId,
    });
    const where = read.calendar.displayName;
    return {
      parse: this.parseView(read),
      event,
      message: `Added ${parse.title} to ${where}${this.when(parse)}.`,
    };
  };

  private read(request: Request) {
    const hints = this.calendar.hints?.(this.now().getTime());
    // With no calendar to write to, a line that reads as an event becomes a reminder, as in the
    // capture box; only an explicit Event fails.
    const kind = (request.kind && KINDS[request.kind]) || (hints ? undefined : "reminder");
    const parse = parseCapture(request.text, { now: this.now(), timeZone: this.timeZone, kind });
    if (!parse?.title) {
      invalidArgument("Say what it is, not just when.");
    }
    return {
      parse,
      calendar:
        parse.kind === "event" ? pickCalendar(parse.title, hints, request.calendar) : undefined,
    };
  }

  private parseView({ parse, calendar }: ReturnType<CaptureService["read"]>) {
    return {
      kind: parse.kind === "event" ? "CAPTURE_KIND_EVENT" : "CAPTURE_KIND_REMINDER",
      reason: parse.reason,
      title: parse.title,
      ...(parse.start && { startTime: parse.start.toISOString() }),
      ...(parse.end && { endTime: parse.end.toISOString() }),
      ...(parse.dueDate && { dueDate: toDateParts(parse.dueDate) }),
      ...(parse.dueTime && { dueTime: toTimeParts(parse.dueTime) }),
      ...(parse.recurrence && { recurrence: parse.recurrence }),
      ...(calendar && { calendar: calendar.calendar, calendarReason: calendar.reason }),
    };
  }

  /** ", Thu 12 Nov 12:30–13:30", ", Fri 13 Nov 10:00", or nothing for Someday. */
  private when(parse: CaptureParse): string {
    const day = (date: string) =>
      new Intl.DateTimeFormat("en-GB", {
        timeZone: "UTC",
        weekday: "short",
        day: "numeric",
        month: "short",
      }).format(new Date(`${date}T00:00:00Z`));
    if (parse.start && parse.end) {
      const start = wallClock(parse.start, this.timeZone);
      const end = wallClock(parse.end, this.timeZone);
      return `, ${day(isoDate(start))} ${hhmm(start.hour, start.minute)}–${hhmm(end.hour, end.minute)}`;
    }
    if (parse.dueDate) {
      return `, ${day(parse.dueDate)}${parse.dueTime ? ` ${parse.dueTime}` : ""}`;
    }
    return "";
  }
}

/** A hand-picked calendar if it is writable, else the guess from history, rules and default. */
function pickCalendar(title: string, hints: CaptureHints | undefined, picked: string | undefined) {
  if (!hints) {
    return undefined;
  }
  const named = (name: string) => hints.calendars.find((c) => c.name === name);
  if (picked) {
    const calendar = named(picked);
    if (!calendar) {
      invalidArgument(`${picked} isn't a calendar you can add events to`);
    }
    return { calendar: picked, displayName: calendar.displayName, reason: "Picked by hand." };
  }
  const guess = chooseCalendar(title, {
    calendars: hints.calendars,
    defaultCalendar: hints.defaultCalendar,
    rules: hints.rules,
    titles: hints.titles,
  });
  return guess && { ...guess, displayName: named(guess.calendar)?.displayName ?? "your calendar" };
}
