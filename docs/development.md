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
device token from `INGEST_TOKENS`. Behind Tailscale Serve, configure `TAILSCALE_PROXY` and
`TAILNET_USERS` to use tailnet sign-in.

The repository's `Dockerfile` is built by the home server's compose project in the private
`pkrshnan/homeserver` repository. Its deployment configuration lives there.
