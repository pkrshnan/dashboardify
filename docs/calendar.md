# Calendar

Two-way sync with one iCloud account, read-only ICS links, and the capture box that turns a line
into an event or a reminder. Messages and fields are in `proto/dashboardify/v1/`
(`calendar_account`, `event`, `capture`); endpoints in [api.md](api.md). Design canvas:
https://claude.ai/artifact/YNnwtKHE7AAzjLswS4JnSc. The original PR plan (C1–C13):
`git show 7d6e452:docs/calendar-plan.md`.

## Decisions

| Area | Decision |
| --- | --- |
| Accounts | One iCloud account (CalDAV, app-specific password), enforced by a unique index; a second returns `ALREADY_EXISTS`. Any number of ICS links, one read-only calendar each. |
| Links | `webcal:` is read as `https:`; `http:` is refused. The URL is sealed like a password and only its host is shown. |
| Writable | From the server's privileges, or forced read-only in Settings. Links are never writable. |
| Categories | Each calendar is work, fitness, personal, relationships, family or focus (default personal) |
| Sync | Polling: CalDAV every 2 min (ctag, then `sync-collection`), links every 15 min (conditional GET), plus one sync right after each write |
| Cache | `$DATA_PATH/calendar-cache.db`, disposable; deleting it forces a full resync. Not in Markdown, except today's `<!-- cc:agenda -->` block in the daily note. |
| Creates | `PUT {calendar}/{uid}.ics` with `If-None-Match: *`; `uid` is `<request_id>@dashboardify`, so a retry gets 412, read as success |
| Edits, deletes | `If-Match: <etag>`; stale returns `ABORTED` and the UI reloads. iCloud always wins; no field merging. |
| Dedupe | The same UID and recurrence-id on several calendars is shown once, preferring the writable copy |
| Recurring | Occurrences are expanded and shown. Creating, editing or deleting a series is `FAILED_PRECONDITION`; "every Monday" capture becomes a recurring task. |
| All-day | Shown in a row above the Day timeline and as hollow markers in Week. Capture never creates them; "Dentist Friday" stays a dated task. |
| Time zones | Stored as UTC plus the event's `TZID`; new events use the Settings time zone. Floating times read in the server's zone. |
| Libraries | Hand-written CalDAV client (`tsdav` is too much to review), `fast-xml-parser`, `ical.js` (server only) |

## Code

| File | Does |
| --- | --- |
| `src/capture/parse.ts` | Pure: text, now, zone → kind, title, times, highlight spans, reason. Runs per keystroke in the browser and again on the server, whose clock wins. |
| `src/capture/choose-calendar.ts` | The calendar guess (below), shared by client and server |
| `src/calendar/caldav.ts` | Discovery, PROPFIND, the three REPORTs, PUT, DELETE, over an injected `fetch` |
| `src/calendar/ical.ts` | iCalendar ↔ events; expands recurrences into the window; writes a VEVENT with its VTIMEZONE |
| `src/calendar/accounts.ts` | `calendar_accounts`, `calendars`, `calendar_settings` in `settings.db`; sealed columns registered for `rotate-key` |
| `src/calendar/cache.ts` | `calendar-cache.db`: resources, occurrences, sync state |
| `src/calendar/sync.ts` | The loop: per-account worker, backoff, status, reload on `store.version()` |
| `src/calendar/feed.ts` | ICS fetch: conditional GET, 30 s timeout, 10 MB cap, https-only redirects |
| `src/calendar/source.ts` | The cache as the home screen's `CalendarSource` |
| `src/calendar/agenda-block.ts` | Today's events into the daily note after a sync changes them |
| `src/server/api/{calendar-accounts,events,capture}.ts` | The three services |

## Sync loop

- **Discovery** on add and daily: principal → calendar home (iCloud redirects to a `pNN-caldav`
  host) → calendars with name, colour, ctag, sync-token and privileges. Calendars without VEVENT
  (task lists) are skipped.
- **Poll:** one PROPFIND for all ctags; unchanged means done. Otherwise `sync-collection` from
  the stored token and `calendar-multiget` for the changed hrefs; a rejected token falls back to
  a full `calendar-query` with etag comparison.
- **Window:** occurrences 30 days back to 60 ahead; titles from the past 180 days feed the guess.
- **Errors:** backoff from 2 min to 1 hour. 401 marks "Sign-in failed" and stops until the
  password is replaced. A link's 401, 403, 404 or 410 marks "Link stopped working", retried
  hourly.
- **Changes from the API or CLI** apply on the next tick through `store.version()`.
- **Startup** serves from the cache and syncs in the background.

`event_id` is the first 16 base32 characters of SHA-256 over
`account/calendar/uid/recurrence-id`: stable across syncs, and known to the client before the
server answers.

## Capture

1. Each keystroke runs the parser and the guess in the browser: highlights, Event or Reminder
   with the reason, the preview line. No network.
2. Return sends `CaptureService.Capture` with the text, a `request_id`, and any kind or calendar
   picked by hand. The client draws the event at once with "Saving to iCloud…".
3. The server parses again, then creates the event (CalDAV PUT, cache upsert) or the task.
4. The response's `message` is the "added · Undo" line and what Siri says. Undo deletes the event
   or task. A failure shows Retry, which resends the same `request_id`.

With no calendar connected, events become reminders. Place lookup ("at Dishoom") is in
[api.md](api.md#places).

### Calendar guess

1. The writable calendar with the most past events whose title matches, or shares its first
   word ("Physio" → Fitness); ties go to the most recent.
2. The first keyword rule whose words are in the title.
3. The default calendar, else the first writable one.

A calendar picked by hand wins until the box is cleared.

## Security

- Basic auth goes only to the account's own host; CalDAV redirects stay under `*.icloud.com`.
  No credentials or link paths in logs.
- Event text is untrusted: rendered as text, and only `https:` links become Join buttons.
- `calendar-cache.db` holds event text in plain form, mode 0600, outside the vault, not backed up.

## Testing

`test/calendar/fake-caldav.ts` is an in-memory iCloud (redirect, ctags, sync tokens, etags,
preconditions, 401s); the demo uses it too. `bun scripts/caldav-check.ts` lists a real
account's calendars and saves nothing.

Manual check against real iCloud: connect; capture an event and Undo it; capture a reminder; add
an event on the phone and see it within 2 minutes; edit and delete it there; add a recurring one;
take the server offline and Retry (one event exists); revoke the password ("Sign-in failed");
add a work ICS link (read-only, not offered for new events).

## Later: more accounts

Each is one PR with no migration: a second iCloud account (drop the unique index), Google (same
client, app password, redirects under `*.google.com`), Microsoft Graph (OAuth, only if a link is
too slow).

## Open questions

- [ ] Capture "Dentist Friday" as an all-day event instead of a dated task?
- [ ] Is a 2-minute poll fast enough, or should loading the home screen trigger a sync when the
      last one is over a minute old?
