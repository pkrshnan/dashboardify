# Development

Use the Bun version pinned in `package.json`. `bun run check` runs what CI runs (lint, proto
lint, typecheck, tests); `bun run format` fixes formatting and imports. Tests use temporary
folders and never touch your vault (the `vault` symlink is git-ignored). Conventions are in
[style.md](style.md).

## Demo

`bun run demo` serves the app on port 8788 with temporary notes, a year of health history and
nights with sleep stages, an Activity page with three months of sessions, and calendars on the
fake iCloud server (`test/calendar/fake-caldav.ts`: Personal, Work, Fitness and a read-only
shared calendar, synced every 30 seconds), so capture, Undo and Settings all work. `DEMO_TIME=09:12` pins the clock for
screenshots.

**On a PR:** the `demo` label runs the demo from that branch on GitHub Actions and comments a
temporary public `trycloudflare.com` URL and token. It stays up 30 minutes and restarts on each
push; removing the label stops it. Actions › Demo › Run workflow starts one on any branch for up
to 60 minutes. It only holds made-up data.

`APPLE_ID=you@icloud.com bun scripts/caldav-check.ts` lists a real iCloud account's calendars and
saves nothing.

## Health primer

[`health-primer.html`](health-primer.html) explains every health number to someone new to it:
what it means, the formula, the papers, a worked example. It is published at
https://claude.ai/artifact/7a89zUGRVaAy9hFDb6BzUL; the file is that page's source, a fragment
with no `<html>` or `<body>` (the host adds them), and it opens in a browser as it is.

A PR that changes how a health number is computed updates the primer too, and the page is
republished from the file once the PR merges.

- **Worked examples** have an id (`ex-<section>`). `test/health/primer.test.ts` works them with
  the real functions, so a changed constant fails until the primer shows the new number. A new
  example gets a case there.
- **Sections** name their files in a `<p class="file">` line. The same test fails when a file in
  `src/health/metrics/` is named nowhere.
- **Not checked:** the prose, the trust notes and the papers. Read the section you touched.
- Formulas are TeX in `.eq` and `.tex` elements, drawn by KaTeX. Same writing rules as the docs.

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
| `strava connect` | Asks for your Strava app's ID and secret, prints the approval link, takes the address you land on |
| `strava disconnect` | Revokes access at Strava and forgets the account |
| `strava status` | The athlete, whether it works, the last sync |

## Hosting

The `Dockerfile` is built by the compose project in the private `pkrshnan/homeserver` repo, which
holds the deployment configuration. The settings CLI is in the image:
`docker compose exec dashboardify bun run settings devices add healthstrap`.
