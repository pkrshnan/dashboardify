# Dashboardify product plan

This directory is the implementation brief for the first usable Dashboardify release.

## Documents

- [Requirements and phased delivery](requirements.md) — product principles, record semantics, functional/non-functional requirements, acceptance gates, and smallest-to-largest implementation order.
- [Interface direction](ui-design.md) — explored visual directions, selected typography and palette, responsive behavior, interaction patterns, component inventory, and accessibility criteria.
- [Live HTML prototype](../../design/dashboard.html) — responsive Today and Quick Capture design; exported as [desktop light](../../design/dashboard-desktop.png), [desktop dark](../../design/dashboard-desktop-dark.png), [mobile light](../../design/dashboard-mobile.png), and [mobile dark](../../design/dashboard-mobile-dark.png).
- [System architecture](architecture.md) — Go/SQLite modular monolith, authentication, capture pipeline, data boundaries, deployment, security, recovery, and scale triggers.

## Decisions fixed for initial implementation

1. Single-user and web-first; responsive PWA rather than native clients.
2. Cloudflare Tunnel + Access as the first ingress, plus application-side token validation and sessions.
3. Go modular monolith with server-rendered HTML and focused JavaScript enhancements.
4. SQLite WAL on a durable local volume with encrypted off-host continuous backup.
5. Raw capture commits before parsing; ambiguous input stays in Inbox.
6. Deterministic parsing before optional cloud/local model classification.
7. Quiet Ledger visual direction: Atkinson Hyperlegible Next at 400–600 weights, JetBrains Mono metadata, adaptive neutrals plus one forest green accent, chronological desktop content, and simplified iOS-inspired mobile grouping.

## Decisions intentionally deferred

- Hosting vendor beyond the requirement for a durable volume.
- Exact OIDC provider connected to Cloudflare Access.
- Standard Go templates versus `templ`; select once during Phase 0 and use one convention.
- Calendar provider and any two-way synchronization.
- Cloud versus local classifier provider.
- Structured exercise/set tracking, pending actual fitness usage.
- Offline writes, native wrappers, and multi-user sharing.

## Phase entry rule

Before code starts for a phase, convert that phase’s numbered items into implementation issues. Each issue must include:

- one observable user outcome;
- affected records/routes;
- migration and rollback/recovery impact;
- authentication, privacy, and abuse considerations;
- responsive and accessibility states;
- one end-to-end verification scenario.

Do not decompose all late phases up front. Their shape should respond to actual usage and the invariants established by earlier phases.

## Immediate next build slice

Phase 0’s first vertical slice should end at an authenticated production URL, not a local scaffold:

1. Create the Go binary and redacted configuration/logging.
2. Serve a minimal semantic shell and `/live` endpoint.
3. Connect Cloudflare Access and validate its JWT inside the application.
4. Bind the approved identity subject to the sole local user and session.
5. Deploy through tunnel-only ingress and verify anonymous, wrong-user, expired-session, and approved-user behavior.

Then add SQLite capture persistence and restore proof before building feature UI.
