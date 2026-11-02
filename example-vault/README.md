# Example vault

A small sample of what the server writes, so you can open it in Obsidian (or any editor) and see the layout. Your real vault lives wherever `VAULT_PATH` points and is never committed here.

| Path | Written by | Notes |
| --- | --- | --- |
| `daily/YYYY/YYYY-MM-DD.md` | journal + health ingest, and you | Frontmatter holds the day's metrics; `## Journal` gets timestamped lines |
| `health/YYYY/YYYY-MM.csv` | health ingest | One row per day, one column per metric |
| `tasks/reminders.md` | reminders ingest | Read-only mirror, rewritten on every sync |
| `inbox/messages/YYYY-MM-DD.md` | messages ingest | `privacy: local-only`: never sent to a cloud model |
| `notes/` | you | Free-form |
| `answers/` | the ask agent (later phase) | Questions with cited answers |
