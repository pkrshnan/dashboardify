# API

Every service is REST under `/v1` and Connect at `/dashboardify.v1.<Service>/<Method>` (unary JSON
or binary protobuf). Both call the same code. Messages and fields are in
[`proto/dashboardify/v1/`](../proto/dashboardify/v1/); after editing them run
`bun run proto:generate` (output in `src/gen/`, checked in).

## Conventions

- **Auth:** `Authorization: Bearer <device token>`, or an allowed tailnet login behind Tailscale
  Serve (the `Tailscale-User-Login` header is trusted only from the configured proxy). Missing or
  bad credentials return `401`. `GET /healthz` and the web app's files are public.
- **JSON:** protobuf JSON. Dates are `{"year": 2026, "month": 11, "day": 3}`, times
  `{"hours": 9, "minutes": 30}`, timestamps RFC 3339, enums by name (`STATE_OPEN`), int64 as strings.
- **Writes:** the body is the resource itself; `requestId`, `updateMask` and similar go in the
  query. A repeated `requestId` returns the original result.
- **Updates:** `updateMask` is comma-separated camelCase fields; without it, every field sent
  changes. A masked field left unset clears it. Send the `etag` you read (body for PATCH, query
  for DELETE, body for actions) to refuse a stale write with `409`.
- **Lists:** `pageSize` (default 50, at most 500) and `pageToken`/`nextPageToken`.
- **Errors:** `400` invalid (Protovalidate), `404` missing, `409` stale etag or duplicate, each
  with `code` and `message`.

## Tasks

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/tasks`, `/v1/tasks/{id}` | List or read |
| POST | `/v1/tasks` | Create in the inbox |
| PATCH | `/v1/tasks/{id}` | Edit `description`, `dueDate`, `dueTime`, `priority`, `recurrence` |
| DELETE | `/v1/tasks/{id}` | Remove the line |
| POST | `/v1/tasks/{id}:complete`, `:reopen` | Complete (adds the next occurrence if recurring) or reopen |
| GET | `/v1/tasks:search?query=bank` | Open tasks matching |

Lists take `filter` on `state` and `due_date` joined with `AND`
(`state = STATE_OPEN AND due_date < "2026-11-04"`) and `orderBy` (default
`due_date, due_time, description`). Create takes structured fields; for "call the bank tomorrow
at 9" use `VoiceService/AddTask` or Captures.

## Days, check-ins, journal, messages

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/days/{YYYY-MM-DD}` | The daily note: path, frontmatter, body (unset if absent) |
| GET, PATCH | `/v1/days/{YYYY-MM-DD}/checkin` | `feel` (1–5), `rpe` (0–10), `tags` (PATCH replaces them) |
| POST, GET | `/v1/days/{YYYY-MM-DD}/journalEntries` | Append under Journal (`text` up to 20,000 characters, optional `entryTime` in that day), or list oldest first |
| POST | `/v1/messages?messageId=…` | Store `sender`, `text`, `receiveTime`; a repeated `messageId` is `409` |
| GET | `/v1/messages` | Newest first; filters on `sender` and `receive_time` |

Days follow the server's time zone.

## Lists

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/lists` | Each list's `name`, `title`, `path` and `openCount` |
| POST | `/v1/lists` | `{"title": "Shopping"}` makes `Lists/Shopping.md`; one already there is returned |
| GET | `/v1/lists/{list}` | Its `sections`, each with `items` (`name`, `text`, `note`, `done`), and `etag` |
| POST | `/v1/lists/{list}/items` | `{"texts": ["eggs, bread"], "section": "Produce"}`: commas add several; a ticked match is unticked in its section, or moved to `section` if given; a new section gets a heading |
| PATCH | `/v1/lists/{list}/items/{item}?updateMask=done` | Tick (`done`), rename (`text`), set the `note`, or move (`section`; `""` is before the first heading) |
| DELETE | `/v1/lists/{list}/items/{item}` | Remove the line |
| POST | `/v1/lists/{list}:clearDone` | Remove every ticked line |

`{list}` is the file name's slug (`Gift ideas.md` → `gift-ideas`). An item's name changes when
its text or section does; the response has the new one. Writes take the list's `etag` and refuse an older
one with `409`. Send `updateMask`: unticking sends `done: false`, and moving to the top `section: ""`, which protobuf JSON leaves
out.

## Habits

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/habits` | Each habit with its `schedule`, `auto` rule, `color`, `state`, `startDate` and `progress` (`streak`, `unit`, `atRisk`, `recentDone` of `recentOf`, `thisWeek`, `due`, `done`) as of `day` (today); `showArchived` |
| GET | `/v1/habits/{habit}` | One, the same way |
| POST | `/v1/habits` | `{"displayName": "Lift", "schedule": {"kind": "KIND_WEEKLY", "timesPerWeek": 3}, "auto": "lifting"}` adds a line to `Habits.md` starting today; one with the same name is returned |
| PATCH | `/v1/habits/{habit}?updateMask=state` | Rename (`displayName`), `schedule`, `auto`, `color`, or pause and archive (`state`) |
| GET | `/v1/habits/{habit}/days` | Each day from `startDate` (36 weeks back) to `endDate` (today), at most 400: `mark` (`MARK_DONE`, `MARK_OPEN`, `MARK_PENDING`, `MARK_BEFORE_START`), `scheduled`, `ticked` |
| POST | `/v1/habits/{habit}:mark` | `{"done": true}` ticks today, or `day`; not a future day |
| GET | `/v1/habitFacts` | The facts a rule can use, with `label`, `kind`, `night` and `defaultRule` |

Days are habit days: until 04:00 it's still the day before. Writes to `Habits.md` take its
`etag` and refuse an older one with `409`; ticks go to the day's note and need none.

## Home

`GET /v1/home`: everything the home screen shows: sentence, next event, seven days of agenda,
task groups, health metrics (`dailyValues` with `missingDays`), sync times, the strap's battery
and capture hints. A located event has a `mapsUri` for Apple Maps. `?asOfDate.year=…` ends the
metrics on that day as if it were today (a later day is today); the rest stays as of now.

## Sample streams

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/streams`, `/v1/streams/{stream}` | Streams and their columns |
| POST | `/v1/streams/{stream}:mergeSamples` | Merge one UTC day's batch |

The body has a UTC `day`, `timestamps` (epoch ms) and `columns`, each with `numbers` or `texts`
(one value per timestamp) and `missingRows`. The first upload fixes the schema. Rows merge by
timestamp, newest wins, so retries are safe; the response counts `rows`, `added`, `replaced`.
healthstrap is the client.

## Activity

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/activityDays?startDate…&endDate…` | Each day's workouts, walks and lifting log, up to 92 days |
| GET | `/v1/days/{date}/workouts/{HHMM}` | One workout: HR every 15 s, and sets for lifting |
| POST | `/v1/days/{date}/workouts/{HHMM}:review` | `{"kind": "lifting"}`: `running`, `walking`, `volleyball`, `lifting`, `workout`, `none`, or `""` to undo |
| GET | `/v1/days/{date}/night` | The night you woke from that day: bed, onset and wake, asleep minutes, score, stage minutes and runs; `404` if none |

`status` is `DETECTED` (strap only), `POSSIBLE` (worth asking), `CONFIRMED` (reviewed, matched a
lifting log, or a Strava run) or `DISMISSED`. Strava runs also have `distanceMeters` and
`stravaActivityId`, and their heart rate covers the walks either side. A review is written to the
daily note and the day is recomputed. A night's stages are estimated: `stagesPlausible` says
whether they look real, and a night without stages leaves the stage fields out.

## Captures

| Method | Path | Does |
| --- | --- | --- |
| POST | `/v1/captures:parse` | Read a line without writing: kind, title, times, calendar, place, why |
| POST | `/v1/captures` | Read it, then create the event in iCloud or the task |

Body: `text`, `requestId`, and `kind` or `calendar` only when picked by hand. The server's clock
and zone win. With no writable calendar an event becomes a reminder (an explicit
`CAPTURE_KIND_EVENT` is `failed_precondition`). The response's `message` is a sentence for Siri.
A place comes from "at Dishoom" (capitalised, so "at 3pm" stays a time) or "@Dishoom"; the best
match is saved with coordinates, or the typed text if none. How it decides: [calendar.md](calendar.md#capture).

## Events

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/events?filter=…`, `/v1/events/{id}` | From the cache, by start (default: next 7 days) |
| POST | `/v1/events?requestId=…` | Create a single event on a writable calendar |
| PATCH | `/v1/events/{id}` | `title`, `location`, `place`, `notes`, `url`, `startTime`, `endTime` |
| DELETE | `/v1/events/{id}` | Delete |

The filter takes `start_time`, `end_time` and `calendar`. Writes reach iCloud before returning.
A `place` is written as `GEO` and `X-APPLE-STRUCTURED-LOCATION`, so Apple Calendar shows the map;
changing `location` alone drops it. Errors: `403` read-only calendar, `409` changed in Apple
Calendar, `400 failed_precondition` recurring event or refused password, `503` iCloud down.

## Places

`GET /v1/places:search?query=Dishoom`: up to five places with `displayName`, `address`,
`location` and `mapsUri`, nearest to Settings' `placesNear` first. From Photon (`PHOTON_URL`,
default photon.komoot.io), cached for an hour; `503` if unreachable.

## Settings and devices

| Method | Path | Does |
| --- | --- | --- |
| GET, PATCH | `/v1/settings` | `timeZone`, `tasksInbox`, `tailnet`, `placesNear` |
| POST | `/v1/devices` | Add a device; the token is in this response only |
| GET | `/v1/devices` | List, with `current` on the caller |
| DELETE | `/v1/devices/{id}` | Revoke at once |

A time zone change applies after a restart (`restartRequired`). A lost token can't be shown again:
add a device and revoke the old one.

## Calendar accounts

| Method | Path | Does |
| --- | --- | --- |
| POST | `/v1/calendarAccounts?validateOnly=true` | Sign in or fetch the link and return what was found, saving nothing |
| POST | `/v1/calendarAccounts` | Save the account and its calendars |
| GET | `/v1/calendarAccounts`, `…/{id}` | With `status`, `passwordSet` or `feedUrlSet` and `feedHost` |
| PATCH | `/v1/calendarAccounts/{id}?updateMask=password` | Replace the password or `feedUrl` |
| POST | `/v1/calendarAccounts/{id}:sync` | Sync now |
| DELETE | `/v1/calendarAccounts/{id}` | Remove it and its calendars |
| GET | `/v1/calendarAccounts/{id}/calendars` | Its calendars |
| PATCH | `/v1/calendarAccounts/{id}/calendars/{c}` | `category`, `enabled`, `forceReadOnly` |
| GET, PATCH | `/v1/calendarSettings` | Default calendar and keyword rules (targets must be writable) |

iCloud: `{"kind": "KIND_CALDAV", "provider": "icloud", "username": …, "password": …}`; a second
one is `409`. Links: `{"kind": "KIND_ICS", "feedUrl": "webcal://…"}`, any number, each with one
read-only calendar `…/calendars/feed`. Passwords and URLs are never returned.

## Voice RPCs

RPC only, for Siri. Each response has a `message` to speak.

| Path | Input | Does |
| --- | --- | --- |
| `/dashboardify.v1.VoiceService/AddTask` | `text`, `requestId` | A task with a spoken date and time |
| `…/Log` | `text` | Append to today's journal |
| `…/CheckIn` | `feel`, `rpe`, `tags` (strings) | Record scores, merge tags |
| `…/ListDue` | `window`: `today`, `overdue`, `week` | Summarise open tasks |
| `…/CompleteByText` | `text` | Complete the closest open task |
| `…/AddToList` | `list`, `text` | Add to the list with that spoken name; commas and "and" separate items |
| `…/TickHabit` | `text` | Tick the habit said ("I meditated"), the day before with "yesterday" or "last night"; speaks the streak |
