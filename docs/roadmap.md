# Roadmap

Goals, standing decisions, and the status board: what is built, what is next. How it fits
together is in [architecture.md](architecture.md). Last audited 2026-11-09 at PR #76.

## Goals

- One place your whole life runs through: health, schedule, tasks, lists, journal, mail and
  messages, readable and controllable on desktop and phone.
- Ask questions about all of it, mainly by voice through Siri, with cited answers.
- Your data lives in plain files you own (the Markdown vault). Server-only state lives in
  `DATA_PATH`.
- Claude for general questions today; everything can switch to local models. Journal and
  messages never leave the server.

Not goals: multiple users, a native app (the PWA and Siri cover it), replying to mail or messages,
Apple Reminders.

## Decisions

| Area | Decision |
| --- | --- |
| Hosting | One process on a Linux home server, reached over Tailscale. Compose lives in `pkrshnan/homeserver`. |
| Stack | Bun and TypeScript; Hono server, Preact web app |
| API | v1 protobuf services (AIP style) as REST under `/v1` and Connect RPC. Everything uses v1. |
| Storage | The vault is the source of truth. `settings.db` holds settings and sealed secrets. Caches can be deleted and rebuilt. |
| Vault sync | Obsidian Self-hosted LiveSync (CouchDB), mirrored to a plain folder by `livesync-bridge`. Backups are restic snapshots. |
| Calendar | One iCloud account over CalDAV, read and write, plus read-only ICS links ([calendar.md](calendar.md)) |
| Tasks | Obsidian Tasks lines anywhere in the vault; new ones go to the inbox note |
| Health | Raw data off the Whoop strap through healthstrap, metrics computed here ([health-metrics.md](health-metrics.md)) |
| Runs | From the Strava API, polled; you record only the running part ([strava.md](strava.md)) |
| Design | Apple-native, dark mode only for now ([design/README.md](design/README.md)) |
| Delivery | Small stacked PRs, each passing `bun run check` with tests and doc updates. A feature first gets a plan doc with a numbered PR list; UI waits for approved artboards. |

## Built

| Area | What works |
| --- | --- |
| Foundation | Strict TypeScript, Biome, CI, Dockerfile, a `demo` label that runs a PR on a temporary URL |
| Vault | Frontmatter, sections, `<!-- cc:name -->` blocks, atomic writes, one writer per file, time-zone-correct days |
| API | 14 v1 services; etags, update masks, `requestId` retries, pagination |
| Tasks | Full API (create, edit, delete, complete with recurrence, reopen, search) and Siri. On screen: a grouped list you can tick, and Day timeline reminders you can tick and untick. |
| Capture | One box: a line becomes an event or a reminder, with the calendar guessed and the place looked up; Undo; Siri "Add to command center" |
| Calendar | iCloud sync every 2 min, ICS links every 15; Day and Week, all-day row, overlap layout; event panel edits and deletes from Day or Week; Week shows locations; agenda block in the daily note |
| Settings | `settings.db`, hashed devices, sealed secrets, setup code, `bun run settings`, Settings page (General, Devices, Calendars) |
| Health | Sleep, sleep score, resting HR, HRV, breathing, skin temperature, strain, zones, steps, recovery, workouts, walks, lifting sets, battery; daily summary in the note; recovery tuning |
| Activity page | Workouts and walks by week, month and 3 months; detail with HR and sets; reviews |
| Home screen | Focus sentence and snapshot, next event, calendar, tasks, health trends with sync labels |
| Journal, check-ins, messages | API and Siri only, no page yet |

## Next

| # | Work | State |
| --- | --- | --- |
| 1 | Navigation: router, modules, command bar, search, sidebar and tab bar | Building: N1, N2, N8 done; [navigation.md](navigation.md) |
| 2 | Tasks page and reminder editing (the API already does it all); starts with N7's task panel | Needs a plan |
| 3 | Lists (shopping): one note per list in `Lists/`, which tasks skip | Built: [lists.md](lists.md) |
| 4 | Journal page: the day's journal and check-in | Needs a plan |
| 5 | The rest of health: training load, calories, VO2max, sleep stages | Training load, calories (workouts included) and VO2max built (H1–H5), sleep stages (H8–H9, fitted to lab nights in H12), trends and `GetNight` (H10); the UI planned in [health-extended.md](health-extended.md) (H11) |
| 6 | Runs from Strava: split walk-run-walk outings, distance and pace | Built: [strava.md](strava.md) |
| 7 | "Log journal" Shortcut recipe | Not started |
| 8 | Home screen: unusual health rows first, a strain target from recovery, light mode | Not started |
| 9 | Recovery feedback, next steps ([health-feedback.md](health-feedback.md#next)) | Not started |
| 10 | Ask: vault index, model providers, a read-only agent with cited answers, Siri, MCP | Not started |
| 11 | Inbox: IMAP triage, daily messages digest | Not started |
| 12 | Local: Ollama guide, morning brief over ntfy | Not started |

## Open questions

- [ ] Which mail accounts (iCloud, Gmail, work)?
- [ ] Which local model fits the server?
- [ ] Capture "Dentist Friday" (no time) as an all-day event or a dated task?
- [ ] Time zone changes need a restart: acceptable, or pick them up live?
