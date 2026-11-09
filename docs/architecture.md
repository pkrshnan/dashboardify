# Architecture

dashboardify is a personal command center. It pulls health, calendar, tasks, journal, mail and messages into one place, and lets you ask questions about all of it, mainly by voice through Siri.

## Principles

- **Files are the source of truth.** Everything lives in a Markdown vault (Obsidian-compatible), with YAML frontmatter for structured fields and CSV for time series. The one exception is the server's own settings (devices, calendar accounts, time zone), which live in SQLite under `DATA_PATH`, outside the vault, because they hold secrets that must never sync to every device. `bun run settings export` gives a readable copy without secrets.
- **Derived data is disposable.** The search index and embeddings live in one SQLite file inside the vault (`.cc/`, git-ignored) and can be rebuilt from the files at any time.
- **No platform lock-in.** The server runs on Linux. Apple-only data (Health, Messages) comes in through iOS Shortcuts posting JSON, so Apple is a source, not a dependency.
- **Swappable models.** Every model call goes through one provider interface: Anthropic (Claude) or any OpenAI-compatible endpoint (Ollama, llama.cpp, vLLM).
- **Private sources stay local.** Journal and messages are tagged `privacy: local-only` and are only ever processed by a model running on the server.

## Components

```mermaid
flowchart TD
  subgraph Sources
    W[healthstrap: raw streams off the Whoop strap]
    C[CalDAV / ICS]
    M[IMAP mail]
    S[iOS Shortcuts: Health, Tasks, Messages, Journal]
  end
  W & C & M & S --> I[Ingest server]
  I --> V[(Markdown vault)]
  V <--> L[LiveSync bridge + CouchDB] <--> O[Obsidian on your devices]
  V --> X[(Index: SQLite FTS + vectors)]
  X --> A[Ask agent]
  A --> P[Model provider: Claude or local]
  A -- cited answers --> V
  V --> U[Web app / PWA]
  Siri[Siri Shortcuts] --> A
  Siri --> I
```

| Component | Responsibility |
| --- | --- |
| Ingest server | Receives pushes from Shortcuts and healthstrap, polls CalDAV and IMAP, and writes into the vault. Only edits regions it owns, so hand-written text is never touched. |
| Vault | Daily notes, tasks, health CSVs, message and mail digests, saved answers. Synced to your devices with Obsidian Self-hosted LiveSync. `livesync-bridge` keeps the server's plain-file vault and CouchDB in step. Backed up nightly with restic to Cloudflare R2. |
| Index | Full-text and vector search plus typed tables parsed from frontmatter and CSVs, so "average HRV on short-sleep nights" is a query, not a guess. |
| Ask agent | Answers a question by searching the index with a fixed set of read-only tools, then writes a cited answer to the vault. |
| Web app | The dashboard (Today view) on desktop and phone. |
| Siri | The main way in. "Ask command center" dictates a question and reads the answer back; "Log journal" captures a line. Both are plain HTTP calls, so Siri can be replaced later without server changes. |

## Sources

| Source | How it arrives | Notes |
| --- | --- | --- |
| Whoop strap | [healthstrap](https://github.com/pkrshnan/healthstrap) reads the 5.0 strap over Bluetooth, without the Whoop app or API, and posts raw per-day streams to `/api/ingest/samples/{stream}` | Heart rate, RR intervals, skin temperature, accelerometer, PPG bursts, wear and sleep state. Stored as Parquet in `health-raw/`, outside the vault. |
| Health metrics | Computed on the server from the raw streams | Strain, recovery, HRV, sleep, VO2max and biological age, using our own documented algorithms. Results are rebuildable tables, and daily values go into the daily note. |
| Whoop export | Optional one-off import of the Whoop app's CSV export | Backfills history before the strap was read directly, seeds baselines and checks our numbers against Whoop's on overlapping days. Kept separate from our own values. |
| Apple Health | Daily Shortcut automation posts metrics | Steps, workouts with routes, VO2max and sleep. Shortcuts can only read Health while the phone is unlocked. |
| Calendar | Server reads and writes one iCloud account over CalDAV (app-specific password, sealed in `settings.db`); a sync loop polls every 2 minutes | Not written to Markdown files. Events live in `$DATA_PATH/calendar-cache.db`, which is derived: deleting it makes the next sync fetch everything again. Each daily note gets a `<!-- cc:agenda -->` block, and the capture box creates events through `CaptureService`. |
| Tasks | Siri Shortcuts call `/api/tasks`; you can also write tasks anywhere in Obsidian | Obsidian Tasks format. New tasks go to the inbox file (`TASKS_INBOX`, default `Inbox.md`). |
| Journal | Written in the daily note, or dictated through Siri | Local-only. |
| Mail | Server reads IMAP directly | Only messages that need you get a note. |
| Messages | Shortcut automation on "message received", filtered on the phone | iMessage has no server-side access. Local-only. |

## Vault layout

```
vault/
  daily/2026/2026-11-02.md        journal, health frontmatter, agenda block
  Inbox.md                        new tasks (any note can hold tasks)
  health/2026/2026-11.csv         one row per day
  inbox/mail/…                    one note per important email
  inbox/messages/2026-11-02.md    daily digest, local-only
  answers/…                       questions with cited answers
  notes/                          your own notes
  .cc/index.sqlite                derived, git-ignored
```

## Hosting

One process on an always-on Linux server, run with Docker or directly. The phone reaches it over Tailscale, so nothing is exposed to the internet. Push notifications go through ntfy.

## Design direction

Apple-native: system font, grouped background with rounded cards, large titles, and system colors used for meaning. Desktop gets a sidebar and a widget layout; the phone gets square widgets and a floating tab bar with a Siri button. The working mockups are in a separate design file and are not checked in here.
