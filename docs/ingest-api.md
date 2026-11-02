# Ingest API and iOS Shortcuts

Every request needs `Authorization: Bearer <token>` with a token from `INGEST_TOKENS`. Bodies are JSON. Successful writes return `201` with the vault path(s) written; bad input returns `400 {"error": "..."}`.

## Endpoints

### `POST /api/ingest/journal`

```json
{ "text": "Long walk. Felt good.", "at": "2026-11-02T18:30:00-08:00" }
```

`at` is optional (defaults to now). Appends `- HH:MM text` to `## Journal` in that day's note, using `TZ_NAME` to pick the day.

### `POST /api/ingest/health`

```json
{ "date": "2026-11-02", "source": "whoop", "metrics": { "recovery": 64, "hrv_ms": 58, "sleep_h": 7.1 } }
```

`date` defaults to today, `source` to `apple-health`. Metric names are lowercase `snake_case`; values must be numbers (rounded to 2 decimals). Merges into the daily note's frontmatter and upserts that day's row in `health/YYYY/YYYY-MM.csv`. Re-sending the same day is safe.

### `POST /api/ingest/reminders`

```json
{ "items": [ { "id": "x-apple-reminder://…", "title": "Renew lease", "list": "Personal", "due": "2026-10-31", "completed": false } ] }
```

Rewrites `tasks/reminders.md` from scratch, grouped by list, in Obsidian Tasks syntax. It is a read-only mirror: send the full set every time.

### `POST /api/ingest/messages`

```json
{ "id": "optional-stable-id", "sender": "Sam", "text": "Moved dinner to 19:00", "received_at": "2026-11-02T20:05:00Z" }
```

Appends to `inbox/messages/YYYY-MM-DD.md`, which is marked `privacy: local-only`. A repeated `id` is ignored.

### `GET /api/today?date=YYYY-MM-DD`

Returns the daily note's frontmatter and body.

## Shortcut recipes

All recipes end with **Get Contents of URL**: method POST, header `Authorization: Bearer <token>`, request body JSON. Reach the server over Tailscale (for example `http://homebox:8787`), so nothing is exposed to the internet.

**Log journal (Siri).** *Dictate Text* → *Get Contents of URL* to `/api/ingest/journal` with `text` = Dictated Text. Name it "Log journal" and say "Hey Siri, log journal".

**Health, daily.** Personal automation at 07:00 → for each of Steps, Resting Heart Rate, Body Mass: *Find Health Samples* (yesterday) → *Calculate Statistics* (sum or average) → POST to `/api/ingest/health` with `date` = yesterday and a `metrics` dictionary, e.g. `steps`, `resting_hr`, `weight_kg`. Shortcuts can only read Health while the phone is unlocked, so the 07:00 run waits until you pick it up.

**Reminders, hourly.** Automation → *Find Reminders* where Is Not Completed → *Repeat with Each* building a dictionary of `id` (the reminder's identifier), `title`, `list`, `due` (formatted `yyyy-MM-dd`) → POST `{ "items": [...] }`.

**Messages.** Personal automation → *Message* trigger (pick senders, or a content filter) → POST `sender` = Sender, `text` = Content, `received_at` = Current Date (ISO 8601). Which filters iOS allows for "any sender" needs testing on your phone; the fallback is reading `chat.db` on an always-on Mac.
