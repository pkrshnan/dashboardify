# Dashboardify product requirements

## Product intent

Dashboardify is a private, personal command center for capturing and recalling the small facts, commitments, and activities that make up daily life. Its primary interaction is one fast text box; its primary value is a trustworthy, calm view of what matters now.

Examples that must work naturally:

- “Remind me to renew my passport next Tuesday at 7 pm at home.” → reminder with due time and place.
- “Sam likes Ethiopian food.” → fact attached to a person.
- “I gymmed today.” → habit/activity log for today.
- “Dentist October 14 at 9:30.” → calendar event proposal.
- “Idea: move the plants into the office.” → note.

## Product principles

1. **Capture first, classify second.** Saving text must never depend on a parser, integration, or model. Ambiguous captures land safely in the inbox.
2. **Private by default.** Every production route and asset is behind authentication. Sensitive data is not placed in logs, analytics, notifications, or public caches.
3. **One home, distinct record types.** The interface feels unified, but tasks, events, notes, facts, habits, and activity logs retain clear semantics.
4. **Useful before intelligent.** Explicit commands and lightweight deterministic parsing ship before model-based classification.
5. **Fast enough to become reflexive.** Capture is keyboard-first, mobile-friendly, optimistic, and available from every screen.
6. **Quiet, not gamified.** No engagement loops, arbitrary scores, confetti, or guilt-inducing streak language.
7. **Portable.** All user-created data can be exported in documented, non-proprietary formats.

## Primary user and environments

Single-user initially. The same account is used from macOS, Linux, a restricted work computer, and mobile browsers. No Apple-only dependency is permitted. The installable web app must remain fully usable in a normal browser where PWA installation is blocked.

## Record model from the user’s perspective

| Record | Meaning | Required fields | Useful optional fields |
| --- | --- | --- | --- |
| Capture | Immutable original input awaiting or recording classification | raw text, captured time, source | parse result, confidence, resolution state |
| Task | An action that can be completed | title, status | due time, reminder time, place, project, recurrence |
| Event | Time reserved on a calendar | title, start | end/duration, place, attendees, external calendar ID |
| Note | Freeform information | body | title, tags, links |
| Fact | A small assertion about a person, place, or subject | subject, statement | category, effective date, source capture |
| Person | A lightweight entity to which facts can attach | display name | aliases, contact links, notes |
| Place | A named or physical location | display name | address, coordinates, aliases |
| Habit | A recurring activity definition | name, cadence | target, unit, active dates |
| Activity log | A dated observation or measurement | activity/habit, occurred time | quantity, unit, note |
| Workout | A structured activity log | occurred time, activity type | duration, exercises, sets, distance, energy |

The original capture remains linked to any record created from it. A classification can be corrected without losing what the user typed.

## Functional requirements

### P0 — Foundation and safety

- A production request is accepted only for the configured user identity.
- Sessions use secure, HTTP-only, same-site cookies and can be revoked.
- State-changing requests have CSRF protection and origin checks.
- The service uses one explicit home timezone; capture stores both UTC and the interpreted timezone.
- Data survives process restarts and has encrypted off-host backups with a tested restore procedure.
- Structured application logs exclude capture text and record bodies.
- Configuration and secrets are supplied outside the repository.
- The app exposes authenticated health/status detail and a minimal unauthenticated liveness endpoint containing no user data.

### P0 — Quick capture and inbox

- A global inline composer is reachable immediately on mobile and with `C` or `⌘K`/`Ctrl+K` on desktop; capture never requires opening a dialog.
- Pressing `Enter` persists the exact raw text immediately and shows a saved state; `Shift+Enter` adds a line.
- Duplicate submits caused by retries are prevented with a client-generated idempotency key.
- The deterministic parser recognizes explicit record prefixes, common reminder phrases, weekday/relative dates, times, trailing `at <place>`/`in <place>`, and event shorthand such as `@ 2:30`.
- Recognized intent, time, date, and place spans are highlighted while typing without rewriting the input.
- Reminder phrases file tasks; a date without a time becomes an all-day reminder in the home timezone. Scheduled shorthand files events, and unmatched text files as a note. The original capture remains immutable and linked.
- Ambiguous captures can still be corrected or reclassified later. Nothing is silently discarded.
- Capture latency target: p95 under 200 ms at the server for a warm local or small-cloud instance, excluding network latency.

### P0 — Today

- Today combines overdue/due tasks, the day’s events, reminders, and activity/habit prompts in chronological order.
- Tasks can be completed, deferred, or edited in place.
- The user can move between days without leaving the view.
- A compact “up next” region remains useful when the day contains many records.
- All displayed times are visibly anchored to the configured timezone.

### P0 — Find and recover

- Search covers titles, note bodies, capture text, people, places, and facts.
- Results identify record type and relevant date; opening a result reveals the original capture.
- Recently archived records are recoverable. Permanent deletion requires an explicit confirmation and respects a retention window.
- A complete export includes JSON data, Markdown notes, and calendar events as ICS.

### P1 — Notes, people, places, and facts

- Notes support plain text and a conservative Markdown subset.
- Facts attach to a person, place, or freeform subject and can be corrected or superseded.
- Person and place pages show related facts, notes, events, and tasks in reverse chronological order.
- Aliases allow “Sam” and a full name to resolve to the same person, with confirmation when ambiguous.
- Records can link to one another without copying content.

### P1 — Calendar and reminders

- Day, three-day, week, and agenda views are responsive and keyboard accessible.
- Events can be created, moved, resized, and cancelled.
- Recurrence supports common daily, weekly, monthly, weekday, and custom interval rules without inventing a separate recurrence format.
- Notifications are opt-in per device. A missed browser notification remains visible in the app.
- External calendar ingestion begins read-only through ICS subscriptions. Two-way sync is deferred until conflict behavior is designed and tested.

### P1 — Habits, activity, and fitness

- Habits have schedule, target, unit, and pause dates.
- Activity can be logged from capture or the Today view in one interaction.
- Backdated entry is allowed and clearly labels the occurrence date separately from the entry date.
- Weekly and monthly summaries show totals and consistency without moralized “failure” states.
- Fitness starts with activity type, duration, distance, and freeform workout details; exercise/set-level structure is added only after real usage shows it is needed.

### P2 — Integrations and automation

- Import from ICS and documented JSON/CSV is repeatable and deduplicated.
- Optional outbound webhooks contain only explicitly selected record types.
- Calendar provider adapters keep provider IDs and sync cursors isolated from core records.
- Rules can route captures based on explicit, inspectable conditions. Rules never delete data.
- Email or share-sheet ingestion is considered only after abuse prevention and identity binding are defined.

### P2 — Assisted classification

- Classification runs after the raw capture is durably saved.
- A provider-independent classifier returns a versioned structured proposal, never direct database writes.
- The proposal includes record type, extracted fields, confidence, assumptions, and unresolved questions.
- Low-confidence or destructive interpretations require confirmation. User corrections are retained for evaluation.
- Cloud model use is explicit and configurable; the UI identifies when capture text leaves the server.
- A local small model can replace the cloud provider without changing capture or filing semantics.
- A fixed private evaluation set measures classification accuracy before prompts or models change.

## Non-functional requirements

### Security and privacy

- No unauthenticated application shell: even hashed JS/CSS assets are protected unless intentionally copied to a non-sensitive static origin.
- Authentication fails closed when identity verification or key discovery is unavailable.
- Authorization uses a stable provider subject, not email text alone.
- Login, session changes, exports, and destructive actions produce metadata-only audit events.
- CSP, HSTS, `X-Content-Type-Options`, frame restrictions, and a strict referrer policy are enabled.
- Dependencies and base images are pinned and updated deliberately.

### Performance and resource use

- Target idle memory below 100 MiB for the application process on a small Linux VM.
- Normal authenticated HTML responses target p95 under 300 ms at the server with 100,000 personal records.
- Initial compressed transfer target is under 200 KiB excluding fonts; no runtime UI framework is required for the core workflow.
- Database queries used by Today, Inbox, and Search have measured query plans and bounded result sets.
- Background jobs are persisted and rate-limited; they cannot starve interactive capture.

### Reliability and portability

- Schema migrations are forward-only, transactional where supported, and run once under a deployment lock.
- Backup success is monitored. Restore is exercised before the service is treated as authoritative.
- Imports are idempotent; integrations expose last-success and last-error states.
- All timestamps are stored in UTC plus the timezone/offset needed to preserve user intent.
- The server runs as a single container or binary plus a persistent data volume; no platform-specific client is required.

### Accessibility and interaction

- WCAG 2.2 AA color contrast, focus visibility, semantic controls, reduced-motion support, and full keyboard operation are required.
- Touch targets are at least 44×44 CSS pixels where space permits.
- Every optimistic action has a visible pending state and a recoverable error state.
- The interface never encodes record type or status by color alone.

## Delivery order

Each phase is intentionally usable on its own. Before implementation begins on a phase, its bullets become small issues with a user-visible acceptance criterion, data migration impact, security impact, and one end-to-end verification scenario.

### Phase 0 — Secure skeleton

Smallest tasks first:

1. Establish the Go service, configuration loading, structured redacted logging, and `/live` endpoint.
2. Add SQLite schema migration tooling and create the user/session/capture tables.
3. Integrate the chosen identity gateway and enforce authentication on every non-liveness route.
4. Add encrypted backup/restore commands and perform a clean restore into a temporary instance.
5. Deploy an authenticated empty shell through the selected hosting path.

**Exit:** the custom URL is inaccessible without identity verification; a signed-in user sees the shell; data survives restart and restore.

### Phase 1 — Capture that cannot lose input

1. Build the responsive global composer.
2. Persist raw captures with idempotency keys.
3. Show saved/error states and an inbox list.
4. Add manual filing into task, event, note, fact, or activity log.
5. Preserve provenance and allow reclassification.
6. Add explicit-prefix and date/time extraction with proposal review.

**Exit:** each example at the top can be captured in seconds and safely filed, even when parsing fails.

### Phase 2 — Daily command center

1. Build task lifecycle and reminder fields.
2. Build event creation and agenda queries.
3. Compose the Today timeline and date navigation.
4. Add inline complete/defer/edit actions with undo.
5. Add device notification permission and an in-app fallback queue.

**Exit:** the app can replace a daily paper task list and agenda without any external integration.

### Phase 3 — Memory and retrieval

1. Add notes with safe Markdown rendering.
2. Add people, places, aliases, and fact history.
3. Add record links and source-capture views.
4. Implement SQLite full-text search and filters.
5. Add archive, restore, export, and retention-based permanent deletion.

**Exit:** “What does Sam like?” and similar queries are answerable quickly, with provenance.

### Phase 4 — Habits and fitness

1. Add habit definitions, schedules, pause dates, and prompts.
2. Add one-tap and natural-language activity logging.
3. Add backdating and correction flows.
4. Build weekly/monthly summaries.
5. Observe real workout usage before deciding whether structured sets and exercises are warranted.

**Exit:** “I gymmed today” is filed correctly and changes a useful weekly view.

### Phase 5 — Calendar and import

1. Build week and three-day calendar surfaces.
2. Implement recurring events using RFC 5545 recurrence rules.
3. Add read-only ICS subscriptions with durable sync state.
4. Add repeatable JSON/CSV/ICS import and duplicate review.
5. Design conflict semantics before enabling any two-way provider sync.

**Exit:** external commitments can be viewed alongside native records without risking changes to the source calendar.

### Phase 6 — Assisted filing

1. Freeze a versioned classification schema and private evaluation set.
2. Implement an asynchronous classifier job and provider interface.
3. Add a cloud provider behind explicit privacy configuration.
4. Build confidence thresholds and a confirmation/correction flow.
5. Evaluate a small local model against the same dataset.
6. Auto-file only proven, high-confidence, reversible cases.

**Exit:** the classifier measurably reduces inbox triage while raw captures remain safe and model outages do not affect capture.

### Phase 7 — Selective expansion

Only usage evidence can promote these: richer fitness structure, automation rules, share-sheet/mobile wrapper, two-way calendar sync, household/multi-user support, or advanced analytics.

## Explicit non-goals for the first release

- Native macOS, Linux, iOS, or Android applications.
- Multi-user sharing or social features.
- Two-way calendar sync.
- Autonomous model actions.
- Medical interpretation, calorie coaching, or health diagnosis.
- A generic plugin platform.
- Offline mutation and conflict resolution. The first PWA may cache its shell, but writes require a connection.
