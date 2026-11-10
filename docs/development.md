# Development

Use the Bun version pinned in `package.json`. `bun run check` runs what CI runs (lint, proto
lint, typecheck, tests); `bun run format` fixes formatting and imports. Tests use temporary
folders and never touch your vault (the `vault` symlink is git-ignored). Conventions are in
[style.md](style.md).

## Demo

`bun run demo` serves the app on port 8788 with temporary notes, health history, an Activity page
with three months of sessions, and calendars on the fake iCloud server
(`test/calendar/fake-caldav.ts`: Personal, Work, Fitness and a read-only shared calendar, synced
every 30 seconds), so capture, Undo and Settings all work. `DEMO_TIME=09:12` pins the clock for
screenshots.

**On a PR:** the `demo` label runs the demo from that branch on GitHub Actions and comments a
temporary public `trycloudflare.com` URL and token. It stays up 30 minutes and restarts on each
push; removing the label stops it. Actions › Demo › Run workflow starts one on any branch for up
to 60 minutes. It only holds made-up data.

`APPLE_ID=you@icloud.com bun scripts/caldav-check.ts` lists a real iCloud account's calendars and
saves nothing.

## Configuration

[`.env.example`](../.env.example) lists the startup values; everything else is in Settings
([settings.md](settings.md)). The web app is served at `/` by the same process. Away from
Tailscale it asks for a device token; behind Tailscale Serve, set the proxy and allowed logins in
Settings › General.

Back up `DATA_PATH` without `secret.key`, and keep the key in a password manager: a backup with
both opens every secret.

## Settings from the terminal

`bun run settings` opens the same `settings.db` as the server (`DATA_PATH`, default `./data`).

| Command | Does |
| --- | --- |
| `export [--out file]` | Settings, devices and calendars as TOML; secrets are `"<set>"` |
| `devices add <name>` | Adds a device and prints its token, the only time it is shown |
| `devices list` | Ids, names, when added and last used |
| `devices revoke <id>` | Its token stops working on the next request |
| `key show` | The key as base64, for your password manager |
| `rotate-key` | A new key, every secret re-sealed. Refuses while the server runs. |

## Hosting

The `Dockerfile` is built by the compose project in the private `pkrshnan/homeserver` repo, which
holds the deployment configuration.
