# HTTP API

All `/api` routes need `Authorization: Bearer <token>`, using a token from `INGEST_TOKENS`. Bodies are JSON. A write returns `201` with the vault path it touched. Bad input returns `400 {"error": "..."}`, and a missing or wrong token returns `401`.

`GET /healthz` is public and returns `{"ok": true}`.

## `POST /api/ingest/journal`

```json
{ "text": "Long walk. Felt good.", "at": "2026-11-02T18:30:00-08:00" }
```

`at` is optional and defaults to now. Appends `- HH:MM text` to `## Journal` in that day's note. The day follows `TZ_NAME`. `text` can be up to 20,000 characters.

## `POST /api/ingest/health`

```json
{ "date": "2026-11-02", "source": "strap", "metrics": { "recovery": 64, "hrv_ms": 58, "sleep_h": 7.1 } }
```

`date` defaults to today, and `source` defaults to `apple-health`. Metric names are lowercase `snake_case`. Values are numbers or numeric strings, rounded to 2 decimals. `date`, `source` and `tags` are reserved names. The metrics are merged into the daily note's frontmatter and into that day's row of `health/YYYY/YYYY-MM.csv`.

## `POST /api/ingest/messages`

```json
{ "id": "optional-stable-id", "sender": "Sam", "text": "Moved dinner to 19:00", "received_at": "2026-11-02T20:05:00Z" }
```

Appends to `inbox/messages/YYYY-MM-DD.md`, which is marked `local-only`. If `id` matches a message already stored, the request returns `{"duplicate": true}` and writes nothing.

## `GET /api/today?date=YYYY-MM-DD`

Returns `{ date, path, frontmatter, body }` for that day's note. `date` defaults to today. If there is no note yet, `body` is `null`.

## `GET /api/status`

Returns `{ "gitHistory": { lastCommitAt, lastPushAt, lastError } }`, or `"gitHistory": null` when git history is off.

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

