# Dashboardify product plan

This directory is the implementation brief for the first usable Dashboardify release.

## Documents

- [Requirements and phased delivery](requirements.md) — product principles, record semantics, functional/non-functional requirements, acceptance gates, and smallest-to-largest implementation order.
- [Interface direction](ui-design.md) — explored visual directions, selected typography and palette, responsive behavior, interaction patterns, component inventory, and accessibility criteria.
- [Live HTML prototype](../../design/dashboard.html) — responsive Today and Quick Capture design; exported as [desktop light](../../design/dashboard-desktop.png), [desktop dark](../../design/dashboard-desktop-dark.png), [mobile light](../../design/dashboard-mobile.png), and [mobile dark](../../design/dashboard-mobile-dark.png).
- [System architecture](architecture.md) — Go/SQLite modular monolith, authentication, capture pipeline, data boundaries, deployment, security, recovery, and scale triggers.

## Decisions fixed for initial implementation

1. Single-user and web-first; responsive PWA rather than native clients.
2. Cloudflare Tunnel + Access as the first ingress, plus application-side token validation.
3. Go modular monolith with a React/TypeScript client embedded in the production binary.
4. SQLite WAL on a durable local volume with encrypted off-host continuous backup.
5. Raw capture commits before parsing; ambiguous input stays in Inbox.
6. Deterministic parsing before optional cloud/local model classification.
7. Quiet Ledger visual direction with adaptive neutrals, one forest green accent, chronological desktop content, and simplified mobile grouping.
8. Apple Calendar uses CalDAV with external app-specific credentials, a dedicated Dashboardify calendar, conditional writes, and explicit conflict resolution.
9. The first Obsidian integration writes only a Dashboardify-owned folder in the local vault and requires no plugin.

## Decisions intentionally deferred

- Hosting vendor beyond the requirement for a durable volume.
- Cloud versus local classifier provider.
- Structured exercise/set tracking, pending actual fitness usage.
- Two-way Obsidian editing, offline writes, native wrappers, and multi-user sharing.

## Phase entry rule

Before code starts for a phase, convert that phase’s numbered items into implementation issues. Each issue must include:

- one observable user outcome;
- affected records/routes;
- migration and rollback/recovery impact;
- authentication, privacy, and abuse considerations;
- responsive and accessibility states;
- one end-to-end verification scenario.

Do not decompose all late phases up front. Their shape should respond to actual usage and the invariants established by earlier phases.

## Current and next build slices

Phase 3 connects Apple Calendar end to end:

1. Discover or create the dedicated iCloud calendar through CalDAV.
2. Push native events and pull external projections on startup, on an interval, and on demand.
3. Use ETags, content hashes, and tombstones to detect edits and deletions.
4. Require an explicit user choice for concurrent changes.
5. Expose connection health and sync controls in the Calendar screen.

Phase 4 starts with safe Markdown notes, retrieval, and a one-way projection into the local Obsidian vault.
