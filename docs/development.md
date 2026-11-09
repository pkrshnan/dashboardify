# Development

Use the Bun version pinned in `package.json`. After installing dependencies:

```sh
bun run check   # lint, proto checks, TypeScript checking, and tests
bun run format  # apply formatting, safe lint fixes, and import organization
```

Tests use temporary folders and do not touch your real vault. The vault access code lives in
`src/vault/`; the `vault` symlink in the repository root is git-ignored. You can verify that with:

```sh
git check-ignore vault
```

The home screen lives in `web/` and is bundled by Bun. `bun run demo` runs it with temporary notes,
health history, and calendar events. To pin the clock for screenshots:

```sh
DEMO_TIME=09:12 bun run demo
```

See the [code style guide](style.md) and [formatting and test layout guide](../STYLE.md)
for conventions. `bun run format:check` checks formatting without changing files. GitHub Actions runs checks on every pull
request using `.github/workflows/ci.yml`.

## Configuration and hosting

[`.env.example`](../.env.example) lists the configuration options, including vault and health
storage paths, time zone, port, task inbox, and sign-in settings. Follow the
[README](../README.md#getting-started) to load the configuration and start the server locally.

The web app is served at `/` by the same process as the API. Away from Tailscale, it asks for a
device token. Devices are kept, hashed, in `$DATA_PATH/settings.db` (default `./data`); the first
start imports them from `INGEST_TOKENS`. Behind Tailscale Serve, configure `TAILSCALE_PROXY` and
`TAILNET_USERS` to use tailnet sign-in.

`DATA_PATH` also holds `secret.key`, which seals secrets in `settings.db`. Back up `DATA_PATH`
without `secret.key`, and keep the key in a password manager: a backup that holds both can open
every secret.

### Calendars in the demo and tests

The demo and the tests talk to `test/calendar/fake-caldav.ts`, an in-memory server shaped like
iCloud (discovery on `caldav.icloud.com`, calendars on a `pNN-caldav` host, ctags, sync tokens,
etags and preconditions). The demo seeds it with Personal, Work, Fitness and a read-only shared
calendar, connects the account and syncs every 30 seconds, so the capture box can add, show and
undo events. To check the real client against iCloud, run
`APPLE_ID=you@icloud.com bun scripts/caldav-check.ts`; it lists your calendars and saves nothing.

### Settings from the terminal

`bun run settings` opens the same `settings.db` as the server (`DATA_PATH`, default `./data`):

| Command | Does |
| --- | --- |
| `export [--out file]` | Settings, devices and calendars as TOML; secrets are `"<set>"` |
| `devices add <name>` | Adds a device and prints its token, the only time it is shown |
| `devices list` | Device ids, names, when added and last used |
| `devices revoke <id>` | Its token stops working on the server's next request |
| `key show` | The key as base64, for your password manager |
| `rotate-key` | A new key; every secret is re-sealed. Refuses while the server runs (`server.lock`) |

The repository's `Dockerfile` is built by the home server's compose project in the private
`pkrshnan/homeserver` repository. Its deployment configuration lives there.
