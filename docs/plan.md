# Plan

This is the build plan for dashboardify. [architecture.md](architecture.md) describes what the system is. This file covers the order it gets built in, how each piece is reviewed, and what "done" means at each step.

## Goals

- One place for health, schedule, tasks, journal, mail and messages, readable on desktop and phone.
- Ask questions about all of it, mainly by voice through Siri, and get cited answers.
- Every piece of data lives in plain files you own: a Markdown vault, synced to your devices with Obsidian Self-hosted LiveSync.
- Claude handles general questions today. Everything can switch to local models, and the journal and messages never leave the server.

## Non-goals (for now)

- Multiple users or sharing.
- A native iOS or macOS app. The web app installs as a PWA, and Siri covers voice.
- Two-way sync with Apple apps. Calendar stays the place you edit events, and tasks live in the vault.
- Writing back to mail or messages, for example sending replies.

## Decisions

| Area | Decision |
| --- | --- |
| Hosting | One process on your always-on Linux server, reached from the phone over Tailscale |
| Language | TypeScript on Bun, for both the server and the web app |
| Storage | Markdown vault as the source of truth. SQLite only for the derived index, which can be rebuilt. |
| Vault sync | Obsidian Self-hosted LiveSync, with CouchDB on the Arch server, so Obsidian mobile works for quick capture. `livesync-bridge` mirrors the CouchDB database to a plain folder on the server, and that folder is the vault the command center reads and writes. There is no git in the vault. Backups are restic snapshots, and recent edits can be recovered from LiveSync's revision history and Obsidian's File recovery. |
| Primary interface | Siri Shortcuts calling the server's HTTP API, with the web app for browsing |
| Privacy | Journal and messages are `local-only` and only ever reach a model running on the server |
| Calendar | Read from CalDAV and ICS. Not mirrored into Markdown files. |
| Tasks | Obsidian Tasks lines in the vault are the only task list. Siri adds, reads and completes them through the server. Apple Reminders isn't used. |
| Mail | Read by the server over IMAP |
| Health | Raw data read straight off the Whoop 5.0 strap by healthstrap, not the Whoop API. We compute strain, recovery, HRV, sleep, VO2max and biological age ourselves. Apple Health adds steps and workouts. A Whoop CSV export can backfill history. |
| Design | Apple-native: system font, grouped cards, system colors for meaning, quiet sidebar |
| CI | GitHub Actions: lint, typecheck and tests on every PR. This is free for public repos. |

## Repository layout

```
.github/workflows/ci.yml   lint, typecheck, test on every PR and on main
src/vault/                 Markdown parsing and editing, safe file writes
src/server/                HTTP server: config, auth, routes
src/sources/               CalDAV, IMAP pollers
src/index/                 SQLite index (FTS5 + vectors + metric tables)
src/ask/                   ask agent: tools, model providers, privacy rules
web/                       Today dashboard (PWA)
shortcuts/                 Siri Shortcut recipes with screenshots
docs/                      architecture, plan, API reference
test/                      tests mirroring src/
```

## How the work is delivered

Each step below is one pull request, stacked on the one before it, so each diff stays small enough to review in one sitting. Every PR:

- passes CI (lint, typecheck, tests) before review;
- adds tests for what it changes;
- updates the docs it affects;
- leaves `main` deployable once merged.

Merge them in order. If an earlier PR changes during review, the ones above it are rebased onto it.

## Milestones

### M1: Capture (first stack)

Done when a line dictated to Siri lands in today's note and syncs to your other devices.

1. **Plan:** this document.
2. **Project setup and CI:** Bun project, TypeScript strict mode, the Biome linter and formatter, the `bun test` runner, and a GitHub Actions workflow. Done when CI runs green on an empty project.
3. **Vault library:** read and edit Markdown with frontmatter, append to a section, replace machine-owned `<!-- cc:name -->` blocks, atomic writes, one writer per file at a time, and time-zone-correct dates. Done when it's fully unit tested, including DST edges and concurrent writes.
4. **Ingest server:** Hono HTTP server, a bearer token per device, plus `POST /api/ingest/journal` and `/messages`, and `GET /api/today`. Done when every endpoint has validation tests and an API reference doc.
5. **Tasks:** `POST /api/tasks` captures into the inbox file, `GET /api/tasks` lists what's due, `GET /api/tasks/match` finds one by name, and `POST /api/tasks/{id}/complete` ticks it off, including recurring tasks. Done when tests cover capture, retries, due windows, matching and recurrence.
6. **Backups:** nightly restic snapshots of the vault, `health-raw/` and healthstrap's SQLite to Cloudflare R2, kept for 7 days, 4 weeks and 12 months. Done when a restore into an empty folder has been tried and documented.
7. **Deploy:** Dockerfile and one docker compose project for the whole server, in the private repo `pkrshnan/homeserver`: dashboardify, Tailscale with HTTPS, CouchDB for Self-hosted LiveSync, `livesync-bridge` into the server's vault folder, healthstrap, the nightly restic backup, and FoundryVTT behind a Cloudflare Tunnel. Still to do: the "Log journal" Shortcut recipe. Done when it runs on your server, the Shortcut works end to end, and a line written by the server shows up in Obsidian on your phone.

### M2: Today

Done when the dashboard replaces opening four apps in the morning.

8. **Strap data and metrics:** the raw samples endpoint that healthstrap posts to, Parquet storage in `health-raw/`, and the metrics job that computes strain, recovery, HRV, sleep, VO2max and biological age into the health CSVs and the daily note. An importer for the Whoop CSV export backfills older history.
9. **Apple Health Shortcut:** a recipe for steps, workouts, VO2max and sleep.
10. **Calendar source:** CalDAV and ICS reader, today's agenda block in the daily note, and events kept in memory for the API.
11. **Today API:** one endpoint that returns everything the dashboard shows.
12. **Web Today screen:** the approved design on desktop and phone, installable as a PWA, with light and dark modes.

### M3: Ask

Done when a spoken question about your own data comes back right and cited.

13. **Index:** SQLite with FTS5, sqlite-vec embeddings from a local model, and metric tables. Rebuilt from the vault by one command.
14. **Model providers:** Anthropic and OpenAI-compatible (Ollama), behind one interface.
15. **Ask agent:** read-only tools (search, read, metrics, agenda) and cited answers written to `answers/`. Privacy routing sends any question that touches local-only sources to the local model.
16. **Siri "Ask command center":** a synchronous answer for quick questions, or a "working on it" reply plus an ntfy push for slow ones.
17. **MCP server:** the same tools exposed over MCP, so other agents can use the vault. This is optional, for example Hermes Agent as a Telegram or Signal front end.

### M4: Inbox

Done when you trust the digest enough to skip the mail app on most days.

18. **IMAP source:** new mail is triaged by importance, and one note is written per message that needs you.
19. **Messages:** the phone-side filter Shortcut and a daily digest summarized by the local model.

### M5: Local

Done when the Anthropic key can be removed and everything still works.

20. **Local setup guide:** Ollama on your server, model choices, and memory needs.
21. **Morning brief:** a scheduled job, written by the local model, pushed to your phone.

## Testing

- **Unit tests** for pure logic, such as Markdown editing, validation and privacy routing.
- **Integration tests** that run the HTTP server against a temporary vault directory.
- **No network in tests.** CalDAV, IMAP and model calls go through interfaces that tests replace with fakes.
- CI runs everything on Ubuntu with Bun pinned to an exact version.

## Security

- Every API call needs a per-device bearer token, compared in constant time.
- The server is reachable only over Tailscale, never the public internet.
- Secrets stay in environment variables, never in the vault or the repo.
- File paths are built only from validated dates and fixed folder names.
- The ask agent only gets read tools plus one tool for writing answers.

## Open questions

- [ ] Which mail accounts should be connected (iCloud, Gmail, work)?
- [ ] Which local model fits your server's RAM and GPU?
