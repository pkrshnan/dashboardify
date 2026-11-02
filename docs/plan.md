# Plan

Implementation starts in a separate PR once the scope below is agreed. Each phase ends with something usable day to day.

## Phases

1. **Capture.** Ingest server, vault writer, git sync, and the Siri "Log journal" Shortcut. Done when a dictated line lands in today's note and syncs to your other devices.
2. **Today.** Whoop, Apple Health, calendar and Reminders sources, plus the Today screen on web and phone. Done when the dashboard replaces opening four apps in the morning.
3. **Ask.** Index, ask agent, Claude provider, cited answers, and the Siri "Ask command center" Shortcut with push notifications for slow answers. Done when a spoken question about your own data comes back right and cited.
4. **Inbox.** IMAP mail triage and filtered message digests. Done when you trust the digest enough to skip the mail app.
5. **Local.** Local model setup (Ollama) for private sources and the morning brief. Done when the Anthropic key can be removed and everything still works.

## Decided

- Replace this repo's previous Go + SQLite app.
- Host on an always-on Linux server, reached over Tailscale.
- Sync the vault with git.
- Siri is the primary interface.
- Journal and messages are local-only.
- Mail is read by the server over IMAP.
- Calendar is not mirrored into Markdown files.
- Reminders stay in Apple Reminders and are mirrored one way.

## Open questions

- [ ] Confirm the health source is Whoop.
- [ ] Which mail accounts (iCloud, Gmail, work)?
- [ ] Reminders sync: match by ID and write only what changed, instead of rewriting the file each sync?
- [ ] Language and stack for the server (proposal: TypeScript on Bun).
- [ ] Which phases are in scope for the first implementation PR.
- [ ] Design changes: fold HRV into recovery, show times on reminders, use each calendar's own color, quieter sidebar.
