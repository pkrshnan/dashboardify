# HTTP API

All `/api` routes need `Authorization: Bearer <token>`, using a token from `INGEST_TOKENS`. Bodies are JSON. A write returns `201` with the vault path it touched. Bad input returns `400 {"error": "..."}`, and a missing or wrong token returns `401`.

`GET /healthz` is public and returns `{"ok": true}`.

## `POST /api/ingest/journal`

```json
{ "text": "Long walk. Felt good.", "at": "2026-11-02T18:30:00-08:00" }
```

`at` is optional and defaults to now. Appends `- HH:MM text` to `## Journal` in that day's note. The day follows `TZ_NAME`. `text` can be up to 20,000 characters.

## `POST /api/ingest/messages`

```json
{ "id": "optional-stable-id", "sender": "Sam", "text": "Moved dinner to 19:00", "received_at": "2026-11-02T20:05:00Z" }
```

Appends to `inbox/messages/YYYY-MM-DD.md`, which is marked `local-only`. If `id` matches a message already stored, the request returns `{"duplicate": true}` and writes nothing.

## `POST /api/ingest/samples/{stream}?day=YYYY-MM-DD`

Raw sensor samples from healthstrap or another device, one stream and one UTC day per request. The body is CSV with a header line, and `Content-Encoding: gzip` is optional but expected.

```
ts,bpm
1793577600000,58
1793577601000,59
```

- `{stream}` is any name made of a-z, 0-9 and `_`, up to 40 characters, such as `heart_rate` or `sleep_state`.
- `ts` comes first and is UTC epoch milliseconds inside `day`. Other columns are lowercase names. A cell can be a number, text, or empty for "no value".
- The first upload fixes a stream's columns, and a column's type (number or text) is fixed by the first value seen in it. A later upload with other columns, or text in a number column, gets a `400`.
- Rows are merged into the day by `ts`, and on a repeated `ts` the newer upload wins, so the phone and the server can each send the part of the day they saw.
- A row outside the day, or one that doesn't parse, rejects the whole upload with `400 {"error": "line N: ..."}`.

Returns `200 { rows, added, replaced }`: rows now stored for the day, new timestamps, and timestamps that were overwritten. Files are written to `HEALTH_RAW_PATH/<stream>/YYYY/MM/YYYY-MM-DD.parquet`, with `ts` as INT64, numbers as DOUBLE and text as STRING. The stream's columns are kept in `HEALTH_RAW_PATH/<stream>/columns.json`.

## `GET /api/today?date=YYYY-MM-DD`

Returns `{ date, path, frontmatter, body }` for that day's note. `date` defaults to today. If there is no note yet, `body` is `null`.

## `GET /api/home`

Everything the home screen shows, worked out on the server so the web app only lays it out. The shape is `HomeView` in [`src/home/types.ts`](../src/home/types.ts):

- `sentence`: one plain sentence with the next event, a judgement on recovery, and at most one overdue task.
- `next`: the event on now or next today, with `inMin` and a `url` for the Join button, or `null`.
- `days`: seven days from today. Each has `events`, `reminders` (tasks with a `⏰` time) and `dated` (untimed tasks due that day).
- `tasks`: open tasks in `Overdue`, `Today`, `This week`, `Later` and `Someday`. Today's timed tasks are left out, because they are on the timeline.
- `health`: ten metrics with the value, the change against baseline (`delta` and `tone`), the baseline mean and SD, and a year of daily values for the charts. The rules are in [design/README.md](design/README.md#health-numbers).

Calendar events are empty until the CalDAV and ICS reader lands (plan step 10).

## Web app

`GET /` serves the home screen (`web/`), which is public: it asks once for a device token and keeps it in the browser. The icons the manifest points to (`/icon.svg`, `/icon-512.png`, `/apple-touch-icon.png`) are public too.

## `POST /api/health/checkin`

```json
{ "feel": 4, "rpe": 7, "tags": ["alcohol", "travel"], "date": "2026-11-03" }
```

How you feel this morning (`feel`, 1–5), how hard today's workout felt (`rpe`, 0–10) and tags. Each is optional but at least one is needed; numbers may be sent as text and tags as a comma-separated string. `date` defaults to today. Writes `feel`, `effort_rpe` and `health_tags` (merged with any already there) to the daily note's frontmatter and returns `201` with a `message` for Siri to read back. See [the feedback loop](health-feedback.md).

## Tasks

Tasks are [Obsidian Tasks](https://publish.obsidian.md/tasks/) lines anywhere in the vault. The server appends new ones to `TASKS_INBOX` (default `Inbox.md`) and edits single lines in place. Every response includes `message`, one plain sentence that Siri reads aloud and the dashboard can show as is. A task is returned as `{ id, path, done, description, time?, priority?, recurrence?, due?, created?, completed? }`. `id` is its 🆔, or a stable reference made from its file and text when it has none.

```
- [ ] Call the bank ⏰ 09:00 📅 2026-11-03 ➕ 2026-11-02 🆔 k7f3a2
```

`⏰ HH:MM` is our addition for a due time. It always sits right after the description, so Tasks still reads every other field.

### `POST /api/tasks`

```json
{ "key": "8F2C…", "text": "Call the bank tomorrow at 9am", "source": "siri" }
```

`key` is made by the device, and the same key always gives the same 🆔, so a retry returns `200 {"status": "already_done"}` instead of adding a second task. `due` (YYYY-MM-DD), `time` (HH:MM) and `priority` (`highest`, `high`, `medium`, `low`, `lowest`) are optional. Without `due`, the date and time are read from the text in `TZ_NAME` and removed from it, so the example above becomes `Call the bank ⏰ 09:00 📅 2026-11-03`. Returns `201 {"status": "created", ...task, "message"}`.

### `GET /api/tasks?due=today|overdue|week|all`

Open tasks, soonest first. `today` is due today, `overdue` is due before today, `week` is today through six days from now, and `all` (the default) is every open task. Returns `{ items, message }`.

### `GET /api/tasks/match?q=…`

Up to five open tasks whose text is closest to `q`, best first, each with a `score` from 0 (exact) to 1. Siri uses it to turn "mark the bank one done" into an id.

### `POST /api/tasks/{id}/complete`

Ticks the task off and adds `✅` with today's date. A recurring task (`🔁 every week`, `every 2 days`, `every weekday`, and so on) gets its next occurrence inserted above it, as Tasks does. Completing a done task returns `{"status": "already_done"}`, and an unknown id returns `404`.

