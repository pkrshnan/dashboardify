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
{ "date": "2026-11-02", "source": "whoop", "metrics": { "recovery": 64, "hrv_ms": 58, "sleep_h": 7.1 } }
```

`date` defaults to today, and `source` defaults to `apple-health`. Metric names are lowercase `snake_case`. Values are numbers or numeric strings, rounded to 2 decimals. `date`, `source` and `tags` are reserved names. The metrics are merged into the daily note's frontmatter and into that day's row of `health/YYYY/YYYY-MM.csv`.

## `POST /api/ingest/messages`

```json
{ "id": "optional-stable-id", "sender": "Sam", "text": "Moved dinner to 19:00", "received_at": "2026-11-02T20:05:00Z" }
```

Appends to `inbox/messages/YYYY-MM-DD.md`, which is marked `local-only`. If `id` matches a message already stored, the request returns `{"duplicate": true}` and writes nothing.

## `GET /api/today?date=YYYY-MM-DD`

Returns `{ date, path, frontmatter, body }` for that day's note. `date` defaults to today. If there is no note yet, `body` is `null`.
