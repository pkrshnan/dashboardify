// EventService: events from the sync cache, and single-event writes to iCloud. A write goes to
// the server first (with If-None-Match or If-Match), then that calendar is synced so the cache
// holds the server's copy and etag. iCloud's version always wins: a stale etag is ABORTED and
// the client reloads.

import type { CalendarAccounts, StoredCalendar } from "../../calendar/accounts";
import { type CachedEvent, type EventCache, eventId } from "../../calendar/cache";
import { CalDavError, PreconditionFailed, Unauthorized } from "../../calendar/caldav";
import { type EventChange, editEvent, NotEditable, writeEvent } from "../../calendar/ical";
import type { CalendarSync } from "../../calendar/sync";
import type { ConnectCalDav } from "./calendar-accounts";
import { ApiError, failedPrecondition, invalidArgument } from "./errors";
import { filterItems } from "./filter";
import { paginate } from "./pagination";
import { type PlaceInput, placeFromInput, placeView } from "./places";
import { requestedFields } from "./update-mask";

const DAY_MS = 86_400_000;

export interface EventDeps {
  accounts: CalendarAccounts;
  cache: EventCache;
  sync: Pick<CalendarSync, "syncCalendar">;
  connect: ConnectCalDav;
  timeZone: string;
  now?: () => Date;
}

interface EventInput {
  name?: string;
  calendar?: string;
  title?: string;
  startTime?: string;
  endTime?: string;
  timeZone?: string;
  location?: string;
  place?: PlaceInput;
  notes?: string;
  url?: string;
  etag?: string;
}

export class EventsService {
  private readonly now: () => Date;

  constructor(private readonly deps: EventDeps) {
    this.now = deps.now ?? (() => new Date());
  }

  getEvent = async (request: { name: string }) => this.view(this.cached(request.name));

  listEvents = async (request: { filter?: string; pageSize?: number; pageToken?: string }) => {
    const [from, to] = range(request.filter, this.now());
    const events = this.deps.cache
      .between(from, to, this.calendarInfo())
      .map((event) => this.view(event))
      .map((view) => ({ ...view, start_time: view.startTime, end_time: view.endTime }));
    const matching = filterItems(events, request.filter, ["start_time", "end_time", "calendar"]);
    const page = paginate(matching, {
      pageSize: request.pageSize || 100,
      pageToken: request.pageToken,
    });
    return {
      events: page.items.map(({ start_time, end_time, ...event }) => event),
      nextPageToken: page.nextPageToken,
    };
  };

  createEvent = async (request: { event: EventInput; requestId?: string }) => {
    const input = request.event;
    const calendar = this.writableCalendar(input.calendar ?? "");
    const [start, end] = times(input.startTime, input.endTime);
    if (!input.title?.trim()) {
      invalidArgument("event.title is required");
    }
    // The request id becomes the UID and the file name, so a retry finds the same event.
    const key = (request.requestId || crypto.randomUUID()).replace(/[^A-Za-z0-9_-]/g, "");
    const uid = `${key}@dashboardify`;
    const ics = writeEvent({
      uid,
      title: input.title.trim(),
      start,
      end,
      timeZone: input.timeZone || this.deps.timeZone,
      location: input.location,
      place: placeFromInput(input.place, "event.place"),
      notes: input.notes,
      url: input.url,
      now: this.now(),
    });
    await this.write(calendar, async (client) => {
      try {
        await client.put(`${calendar.href}${key}.ics`, ics);
      } catch (error) {
        // Already there: an earlier try of this request got through.
        if (!(error instanceof PreconditionFailed)) {
          throw error;
        }
      }
    });
    const made = this.deps.cache.get(eventId(calendar.accountId, calendar.id, uid, undefined));
    return made
      ? this.view(made)
      : { name: `events/${eventId(calendar.accountId, calendar.id, uid, undefined)}`, uid };
  };

  updateEvent = async (request: { event: EventInput & { name: string }; updateMask?: string }) => {
    const event = this.cached(request.event.name);
    const calendar = this.editable(event);
    const input = request.event;
    const fields = requestedFields(request, input, EDITABLE);
    const stored = this.deps.cache.resource(event.accountId, event.calendarId, event.href);
    if (!stored) {
      throw new ApiError(404, "event not found");
    }
    if (input.etag && input.etag !== stored.etag) {
      throw changedOnServer();
    }
    const change = {
      ...changeFrom(fields, input, event),
      timeZone: this.deps.timeZone,
      now: this.now(),
    };
    let ics: string;
    try {
      ics = editEvent(stored.ics, change);
    } catch (error) {
      if (error instanceof NotEditable) {
        failedPrecondition(error.message);
      }
      throw error;
    }
    await this.write(calendar, (client) =>
      client.put(event.href, ics, stored.etag).then(() => undefined),
    );
    return this.view(this.cached(request.event.name));
  };

  deleteEvent = async (request: { name: string; etag?: string }) => {
    const event = this.cached(request.name);
    const calendar = this.editable(event);
    const stored = this.deps.cache.resource(event.accountId, event.calendarId, event.href);
    const etag = request.etag || stored?.etag || "";
    await this.write(calendar, async (client) => {
      try {
        await client.delete(event.href, etag);
      } catch (error) {
        if (!(await this.alreadyGone(event, error))) {
          throw error;
        }
      }
    });
    this.deps.cache.remove(event.accountId, event.calendarId, event.href);
    return {};
  };

  /**
   * A failed delete may mean it was deleted elsewhere first: a 404, or a 412 because If-Match
   * has nothing to match. Sync the calendar and see whether the event is still there.
   */
  private async alreadyGone(event: CachedEvent, error: unknown): Promise<boolean> {
    if (error instanceof CalDavError && error.status === 404) {
      return true;
    }
    if (!(error instanceof PreconditionFailed)) {
      return false;
    }
    await this.deps.sync.syncCalendar(event.accountId, event.calendarId);
    return !this.deps.cache.resource(event.accountId, event.calendarId, event.href);
  }

  /** Runs one write against the calendar's server, maps its errors, then resyncs. */
  private async write(
    calendar: StoredCalendar,
    run: (client: ReturnType<ConnectCalDav>) => Promise<void>,
  ): Promise<void> {
    const account = this.deps.accounts.get(calendar.accountId);
    if (!account) {
      throw new ApiError(404, "calendar account not found");
    }
    const client = this.deps.connect({
      serverUrl: account.serverUrl,
      username: account.username,
      password: this.deps.accounts.password(account.id),
    });
    try {
      await run(client);
    } catch (error) {
      throw this.writeError(account.id, error);
    }
    try {
      await this.deps.sync.syncCalendar(calendar.accountId, calendar.id);
    } catch {
      // The write happened; the next tick will bring the cache up to date.
    }
  }

  private writeError(accountId: string, error: unknown): Error {
    if (error instanceof PreconditionFailed) {
      return changedOnServer();
    }
    if (error instanceof Unauthorized) {
      this.deps.accounts.setStatus(accountId, "auth_failed", error.message);
      return new ApiError(
        400,
        "iCloud refused the password. Replace it in Settings.",
        "failed_precondition",
      );
    }
    if (error instanceof CalDavError && error.status === 403) {
      return new ApiError(403, "iCloud says this calendar is read-only.", "permission_denied");
    }
    if (error instanceof ApiError) {
      return error;
    }
    return new ApiError(503, "Couldn't reach iCloud. Try again in a moment.", "unavailable");
  }

  private cached(name: string): CachedEvent {
    const id = name.startsWith("events/") ? name.slice("events/".length) : "";
    const event = id ? this.deps.cache.get(id) : undefined;
    if (!event) {
      throw new ApiError(404, "event not found");
    }
    return event;
  }

  /** The event's calendar, if it can be changed: writable, and not a recurring occurrence. */
  private editable(event: CachedEvent): StoredCalendar {
    if (event.recurring) {
      failedPrecondition(
        "Recurring events can't be changed here yet. Change it in Apple Calendar.",
      );
    }
    return this.writableCalendar(
      `calendarAccounts/${event.accountId}/calendars/${event.calendarId}`,
    );
  }

  private writableCalendar(name: string): StoredCalendar {
    const match = /^calendarAccounts\/([^/]+)\/calendars\/([^/]+)$/.exec(name);
    const calendar = match
      ? this.deps.accounts.calendar(match[1] ?? "", match[2] ?? "")
      : undefined;
    if (!calendar) {
      invalidArgument(
        "event.calendar must be a calendar, such as calendarAccounts/icloud/calendars/home",
      );
    }
    if (!(calendar.serverWritable && !calendar.forceReadOnly)) {
      throw new ApiError(
        403,
        `${calendar.displayName} is read-only, so events can't be added or changed there.`,
        "permission_denied",
      );
    }
    return calendar;
  }

  private calendarInfo() {
    const info = new Map<string, { writable: boolean; enabled: boolean; sort: number }>();
    for (const account of this.deps.accounts.list()) {
      for (const c of this.deps.accounts.calendars(account.id)) {
        info.set(`${account.id}/${c.id}`, {
          writable: c.serverWritable && !c.forceReadOnly,
          enabled: c.enabled,
          sort: info.size,
        });
      }
    }
    return info;
  }

  private view(event: CachedEvent) {
    const calendar = this.deps.accounts.calendar(event.accountId, event.calendarId);
    const stored = this.deps.cache.resource(event.accountId, event.calendarId, event.href);
    return {
      name: `events/${event.eventId}`,
      calendar: `calendarAccounts/${event.accountId}/calendars/${event.calendarId}`,
      title: event.title,
      startTime: event.start.toISOString(),
      endTime: event.end.toISOString(),
      timeZone: event.timeZone ?? "",
      allDay: event.allDay,
      location: event.location,
      ...(event.geo && { place: placeOf(event.location || event.title, event.geo) }),
      notes: event.notes,
      url: event.url,
      category: calendar?.category ?? "personal",
      writable: Boolean(calendar?.serverWritable && !calendar.forceReadOnly) && !event.recurring,
      recurring: event.recurring,
      uid: event.uid,
      etag: stored?.etag ?? "",
    };
  }
}

/** The location as a Place: its first line is the name, the rest the address. */
function placeOf(location: string, geo: { latitude: number; longitude: number }) {
  const [name = "", ...address] = location.split("\n");
  return placeView({ name, address: address.join(", "), ...geo });
}

const EDITABLE = ["title", "location", "place", "notes", "url", "startTime", "endTime"];

/** The edit for the masked fields; times are checked together, so an end can't pass the start. */
function changeFrom(fields: string[], input: EventInput, event: CachedEvent) {
  const has = (field: string) => fields.includes(field);
  const change: Omit<EventChange, "timeZone" | "now"> = {};
  if (has("title")) {
    change.title = input.title?.trim() || "(No title)";
  }
  for (const field of ["location", "notes", "url"] as const) {
    if (has(field)) {
      change[field] = input[field] ?? "";
    }
  }
  if (has("place")) {
    change.place = placeFromInput(input.place, "event.place") ?? null;
  }
  if (has("startTime") || has("endTime")) {
    [change.start, change.end] = newTimes(has, input, event);
  }
  return change;
}

function newTimes(has: (field: string) => boolean, input: EventInput, event: CachedEvent) {
  return times(
    has("startTime") ? input.startTime : event.start.toISOString(),
    has("endTime") ? input.endTime : event.end.toISOString(),
  );
}

function changedOnServer(): ApiError {
  return new ApiError(
    409,
    "It changed in Apple Calendar since you loaded it. Reload and try again.",
    "aborted",
  );
}

function times(startTime: string | undefined, endTime: string | undefined): [Date, Date] {
  const start = new Date(startTime ?? "");
  const end = new Date(endTime ?? "");
  if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime())) {
    invalidArgument("event.start_time and event.end_time are required");
  }
  if (end <= start) {
    invalidArgument("event.end_time must be after event.start_time");
  }
  return [start, end];
}

/** The time range a filter asks for, so only that part of the cache is read. */
function range(filter: string | undefined, now: Date): [Date, Date] {
  const after = /end_time\s*>=?\s*"([^"]+)"/.exec(filter ?? "")?.[1];
  const before = /start_time\s*<=?\s*"([^"]+)"/.exec(filter ?? "")?.[1];
  const from = after ? new Date(after) : now;
  const to = before ? new Date(before) : new Date(now.getTime() + 7 * DAY_MS);
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    invalidArgument("unsupported filter");
  }
  return [from, to];
}
