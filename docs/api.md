# API

Use the v1 API for new integrations. It is available as REST under `/v1` and as Connect unary
RPCs at `/dashboardify.v1.<Service>/<Method>`. Both call the same services and use the same stores.
The [protobuf definitions](../proto/dashboardify/v1/) describe the resources and RPC messages.

## Authentication

Send `Authorization: Bearer <token>` using a device token. Devices live in `settings.db` under
`DATA_PATH`, which stores only a SHA-256 hash of each token. On the first start, the server
imports the `name:token` pairs in `INGEST_TOKENS` as devices, so existing tokens keep working;
after that the variable is no longer read. Missing or invalid credentials return `401`.

Behind Tailscale Serve, an allowed tailnet login can replace the token when `TAILSCALE_PROXY`
and `TAILNET_USERS` are configured. The server trusts the `Tailscale-User-Login` header only
from the configured proxy address. See [configuration](../.env.example).

`GET /healthz` is public and returns `{"ok": true}`. The web app and its public assets do not
require a token to load; its API requests still require authentication.

## Request and response format

REST uses protobuf JSON. Dates are `{ "year": 2026, "month": 11, "day": 3 }`, local times are
`{ "hours": 9, "minutes": 30 }`, timestamps are RFC 3339 strings, enums use names such as
`STATE_OPEN`, and int64 values are decimal strings. Default-valued fields may be omitted.

REST writes put the resource itself in the body, rather than its RPC request envelope. Other
request fields, such as `requestId`, `messageId`, and `updateMask`, go in query parameters.
The stream merge action takes its request fields directly in the body.

Successful v1 REST methods return `200`, including creation and deletion. Schema validation is
shared through Protovalidate. Invalid input returns `400`, missing resources return `404`, and
stale etags or duplicate message IDs return `409`. Service errors have a `code` and `message`;
authentication failures use the authentication middleware's `error` field.

## Tasks

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/v1/tasks/{id}` | Read a task |
| GET | `/v1/tasks` | List tasks |
| POST | `/v1/tasks` | Create a task in the inbox |
| PATCH | `/v1/tasks/{id}` | Edit selected fields |
| DELETE | `/v1/tasks/{id}` | Remove the task line |
| POST | `/v1/tasks/{id}:complete` | Complete a task and create its next occurrence if recurring |
| POST | `/v1/tasks/{id}:reopen` | Reopen a completed task |
| GET | `/v1/tasks:search?query=bank` | Find matching open tasks |

A task's resource name is `tasks/{id}`. The description excludes Obsidian task markers.
Writable fields are `description`, `dueDate`, `dueTime`, `priority`, and `recurrence`.
State changes use the complete and reopen actions.

For example, with `SERVER` and `TOKEN` set for your installation:

```sh
curl "$SERVER/v1/tasks?requestId=capture-001" \
  -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d '{"description":"Call the bank","dueDate":{"year":2026,"month":11,"day":3}}'
```

Reusing a `requestId` returns the original task. This resource method expects structured fields;
use VoiceService.AddTask for natural-language input such as "call the bank tomorrow at 9am".

Lists accept `pageSize`, `pageToken`, `filter`, and `orderBy`. Default ordering is
`due_date, due_time, description`; ordering fields may use `asc` or `desc`. Supported filters
are comparisons on `state` and `due_date` joined with `AND`, for example:

```text
state = STATE_OPEN AND due_date < "2026-11-04"
```

## Days and check-ins

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/v1/days/{YYYY-MM-DD}` | Read a daily note |
| GET | `/v1/days/{YYYY-MM-DD}/checkin` | Read its check-in |
| PATCH | `/v1/days/{YYYY-MM-DD}/checkin` | Update the check-in |

Dates follow the server's `TZ_NAME`. Check-ins contain optional `feel` (1–5), `rpe` (0–10),
`tags`, and an `etag`. A PATCH of `tags` replaces the list; VoiceService.CheckIn merges tags.
A day response includes its vault path and frontmatter, with `body` unset when the note is absent.

## Journal entries

`POST /v1/days/{YYYY-MM-DD}/journalEntries` appends an entry under the day's Journal heading.
The body contains `text` and an optional `entryTime`. Text may be multiline, up to 20,000
characters. The timestamp must fall in the parent day in the server's time zone; if omitted,
the server uses its current local time on that day. An optional `requestId` query parameter
makes retries return the original entry.

`GET /v1/days/{YYYY-MM-DD}/journalEntries` lists entries oldest first, using `pageSize` and
`pageToken` for pagination.

## Messages

`POST /v1/messages` stores a message with required `sender`, `text`, and `receiveTime` fields.
The optional `messageId` query parameter supplies a stable phone-generated ID. A duplicate
returns `409`.

`GET /v1/messages` lists messages newest first, including messages stored in Markdown notes. It supports
pagination and comparison filters on `sender` and `receive_time`, joined with `AND`.

## Sample streams

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/v1/streams` | List stored streams and their columns |
| GET | `/v1/streams/{stream}` | Read a stream's column schema |
| POST | `/v1/streams/{stream}:mergeSamples` | Merge a batch for one UTC day |

The merge body contains a UTC `day`, `timestamps` in epoch milliseconds, and typed `columns`:

```json
{
  "day": { "year": 2026, "month": 11, "day": 3 },
  "timestamps": ["1793664000000", "1793664001000"],
  "columns": [
    { "name": "bpm", "numbers": { "values": [60, 0] }, "missingRows": [1] }
  ]
}
```

Each column has either `numbers` or `texts`, with one value per timestamp. `missingRows`
contains zero-based indexes whose placeholder values should be stored as missing. Timestamps
must fall in the stated UTC day. The first upload establishes the stream's schema; subsequent
uploads must match it.

Rows merge by timestamp, with the newer row winning. The response reports `rows`, `added`, and
`replaced` as int64 values. Retrying a batch is safe. Raw data lives under `HEALTH_RAW_PATH` as
Parquet, with a `columns.json` schema for each stream. The updated healthstrap client uses this
endpoint; deploy a server that supports it before updating the client.

## Home

`GET /v1/home` returns the computed home resource: the current sentence, next event, seven days
of agenda items, task groups, and health metric trends. It uses protobuf date/time objects
and fields such as `nextEvent`, `taskGroups`, and `metrics`.

Metric series use `dailyValues` plus `missingDays` indexes to represent missing data.
The regular server has no calendar source by default; the demo supplies sample events.

## Settings

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/v1/settings` | Read the time zone, tasks inbox and tailnet sign-in |
| PATCH | `/v1/settings` | Change the fields in `updateMask` (lowerCamelCase), or every field sent |

`timeZone` is an IANA name; empty means the server's own zone. A change to it is saved at once but
applies after a restart, and the response lists it in `restartRequired`. The tasks inbox and
tailnet sign-in apply to the next request. `envOverrides` lists fields still set in `.env`, which
win over Settings; changing one returns `400` naming the variable to remove. Send the `etag` from a
read to reject the update (`409`) if Settings changed in between.

```sh
curl -X PATCH "$SERVER/v1/settings?updateMask=timeZone" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"timeZone": "Europe/London"}'
```

## Devices

| Method | Path | Operation |
| --- | --- | --- |
| POST | `/v1/devices` | Add a device; the response holds its token, the only time it is shown |
| GET | `/v1/devices` | List devices, with `current` set on the caller's own |
| DELETE | `/v1/devices/{id}` | Revoke a device; its token stops working on the next request |

Only a hash of each token is stored, so a lost token can't be shown again: add a new device and
revoke the old one. `requestId` on create makes a retry within ten minutes return the same device
and token.

## Calendar accounts

One iCloud account, read and write, over CalDAV with an app-specific password.

| Method | Path | Operation |
| --- | --- | --- |
| POST | `/v1/calendarAccounts?validateOnly=true` | Sign in and list the calendars found, saving nothing |
| POST | `/v1/calendarAccounts` | Sign in, then save the account and its calendars |
| GET | `/v1/calendarAccounts`, `/v1/calendarAccounts/{id}` | Read accounts, with `status` and `passwordSet` |
| PATCH | `/v1/calendarAccounts/{id}?updateMask=password` | Replace the password, after signing in with it |
| POST | `/v1/calendarAccounts/{id}:sync` | Find calendars again now |
| DELETE | `/v1/calendarAccounts/{id}` | Remove the account and its calendars |
| GET | `/v1/calendarAccounts/{id}/calendars` | List its calendars |
| PATCH | `/v1/calendarAccounts/{id}/calendars/{calendar}` | Change `category`, `enabled` or `forceReadOnly` |
| GET, PATCH | `/v1/calendarSettings` | The default calendar and keyword rules |

**Calendar links** are accounts too: `{"kind": "KIND_ICS", "feedUrl": "webcal://…"}`, any number
of them, each with one read-only calendar (`…/calendars/feed`). `validateOnly` fetches the feed once
and returns its own name and `eventCount`. Only `https:` and `webcal:` links are accepted, and every
redirect must stay on `https:`. The URL is sealed like a password and never returned; responses
carry `feedUrlSet` and `feedHost`. Links are fetched every 15 minutes with a conditional GET; one
that stops working shows `STATUS_UNREACHABLE` with "Link stopped working…".

The password is stored sealed and never returned. A password iCloud refuses returns `400` with
code `failed_precondition` and a hint to use an app-specific password. A second iCloud account
returns `409` `already_exists`. The default calendar and keyword rule targets must be writable.

```sh
curl -X POST "$SERVER/v1/calendarAccounts?validateOnly=true" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"kind": "KIND_CALDAV", "provider": "icloud", "username": "you@icloud.com", "password": "xxxx-xxxx-xxxx-xxxx"}'
```

## Activity

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/v1/activityDays?startDate.year=2026&startDate.month=11&startDate.day=2&endDate.year=2026&endDate.month=11&endDate.day=8` | Each day's workouts, walks and lifting log, up to 92 days |
| GET | `/v1/days/{YYYY-MM-DD}/workouts/{HHMM}` | One workout, with heart rate every 15 seconds and, for lifting, its sets |
| POST | `/v1/days/{YYYY-MM-DD}/workouts/{HHMM}:review` | Say what a workout was |

These read the computed health tables, so a day appears once its summary has run. A workout's
name is its day and local start time, such as `days/2026-11-08/workouts/1806`. Its `status` says
how sure its `kind` is: `WORKOUT_STATUS_DETECTED` from the strap alone, `WORKOUT_STATUS_POSSIBLE`
when worth asking (lifting with no log that day, or a workout of unknown kind),
`WORKOUT_STATUS_CONFIRMED` after a review or when the daily note's lifting log matched it, and
`WORKOUT_STATUS_DISMISSED` when you said it wasn't a workout.

A review's body is `{"kind": "lifting"}`: one of `running`, `walking`, `volleyball`, `lifting`,
`workout`, `none` for not a workout, or `""` to take a review back. It goes into the daily note's
frontmatter (see [vault format](vault-format.md)), the day is recomputed, and the workout is
returned as it now stands.

## Captures

| Method | Path | Operation |
| --- | --- | --- |
| POST | `/v1/captures:parse` | Read a line without writing: event or reminder, title, times, calendar, and why |
| POST | `/v1/captures` | Read a line, then create the event in iCloud or the task in the inbox |

Body: `text`, optional `requestId` (the same id always gives one event or task), and `kind`
(`CAPTURE_KIND_EVENT` or `CAPTURE_KIND_REMINDER`) and `calendar` only when picked by hand. The
server reads the line with its own clock and zone. With no writable calendar, a line that reads as
an event becomes a reminder; an explicit `CAPTURE_KIND_EVENT` then returns `failed_precondition`.
The response's `message` is a sentence such as "Added Lunch with Sam to Personal, Wed 4 Nov
12:30–13:30."

## Events

| Method | Path | Operation |
| --- | --- | --- |
| GET | `/v1/events?filter=…` | List events from the sync cache, by start time |
| GET | `/v1/events/{id}` | Read one |
| POST | `/v1/events?requestId=…` | Create a single event on a writable calendar |
| PATCH | `/v1/events/{id}?updateMask=title,startTime` | Change title, location, notes, url, start or end |
| DELETE | `/v1/events/{id}` | Delete it |

Reads never wait on iCloud. Writes go to iCloud before returning, then that calendar is synced.
`requestId` becomes the event's UID, so a retried create returns the same event. The filter takes
`start_time`, `end_time` and `calendar`, such as
`end_time > "2026-11-10T00:00:00Z" AND start_time < "2026-11-17T00:00:00Z"`; without a range it
lists the next seven days.

| Error | When |
| --- | --- |
| `403 permission_denied` | The calendar is read-only |
| `409 aborted` | It changed in Apple Calendar since you read it (stale `etag`) |
| `400 failed_precondition` | A recurring event (change it in Apple Calendar), or iCloud refused the password |
| `503 unavailable` | iCloud couldn't be reached |

## Updates, concurrency, and pagination

Task and check-in PATCH requests accept an `updateMask` query parameter containing comma-separated
camelCase fields. Snake_case query names and mask paths are also accepted. An omitted mask changes
only supplied writable fields. A masked unset optional field clears it; a task's required
description cannot be cleared. A mask of `tags` replaces the entire tag list.

Send the resource's returned `etag` to reject intervening edits. For PATCH it goes in the body;
for DELETE it goes in the query; for complete/reopen it goes in the action body.

List methods default to 50 items and cap pages at 500. Pass the returned `nextPageToken` back as
`pageToken` with the same filters and ordering to continue. Omitted or empty `nextPageToken` means
there are no more pages.

## Voice RPCs

Voice methods are RPC-only. Send a JSON request to the paths below with the same authentication:

| Path | Input | Behavior |
| --- | --- | --- |
| `/dashboardify.v1.VoiceService/AddTask` | `text`, optional `requestId` | Parse a spoken date/time and capture a task |
| `/dashboardify.v1.VoiceService/Log` | `text` | Append to today's journal |
| `/dashboardify.v1.VoiceService/CheckIn` | Optional string `feel`, `rpe`, `tags` | Record scores and merge comma-separated tags |
| `/dashboardify.v1.VoiceService/ListDue` | `window`: `today`, `overdue`, or `week` | Summarize open tasks |
| `/dashboardify.v1.VoiceService/CompleteByText` | `text` | Complete the closest matching open task |

Responses include a `message` for Siri to speak, plus a resource name where applicable.
Other protobuf services are also available through their Connect service/method paths.
Connect supports unary JSON and binary protobuf; gRPC and gRPC-web are not enabled.

After editing schemas, run `bun run proto:generate`. Generated TypeScript is checked in under
`src/gen`; validation descriptors are imported from the Protovalidate package.
