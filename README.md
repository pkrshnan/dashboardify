# dashboardify

A personal command center whose only source of truth is a folder of Markdown files.

Health, calendar, tasks, journal, mail and messages flow into a vault you can open in Obsidian or any editor. You can ask questions about all of it, mostly by voice through Siri. The search index and dashboard are rebuilt from the vault, so deleting the app never loses data.

**Status:** building milestone 1 (capture). See the [plan](docs/plan.md).

- [Architecture](docs/architecture.md): principles, components, sources, vault layout
- [Plan](docs/plan.md): phases, decisions so far, open questions
- [HTTP API](docs/api.md) and [vault format](docs/vault-format.md)
- Deploy: the `Dockerfile` here is built by the home server's compose project (private repo `pkrshnan/homeserver`)

## Development

Requires [Bun](https://bun.sh) (version pinned in `package.json`).

```sh
bun install
bun run check   # lint + typecheck + tests, the same as CI
bun run format  # auto-fix formatting and import order
bun run demo    # the web app with made-up data, on http://localhost:8788
cp .env.example .env && set -a && . ./.env && set +a && bun run dev
```

### Your vault

Your notes never go in this repo. Link your real vault into the checkout as `vault`, which is git-ignored:

```sh
ln -s ~/path/to/your/vault vault   # macOS or Linux
git check-ignore vault             # prints "vault", so git will never pick it up
```

`.env.example` already sets `VAULT_PATH=./vault`. The code that reads and writes notes lives in `src/vault/`, and that folder is part of the repo. Tests use temporary folders, so they never touch your real vault.

### The web app

The home screen lives in `web/` (Preact, bundled by Bun) and is served at `/` by the same server. Through Tailscale it signs you in with your tailnet login (`TAILSCALE_PROXY` and `TAILNET_USERS`); elsewhere it asks for one of the `INGEST_TOKENS` tokens. `bun run demo` serves it with made-up health data, tasks and calendar events and prints the token to use; `DEMO_TIME=09:12 bun run demo` pins the clock for screenshots.

See [docs/style.md](docs/style.md) for the code style.

CI runs on every pull request through GitHub Actions (`.github/workflows/ci.yml`).

### Version 1 API

The services in `proto/dashboardify/v1` are implemented at their annotated `/v1/...`
REST paths and as Connect unary RPCs at `/dashboardify.v1.<Service>/<Method>`.
Both transports share the same authenticated handlers and vault/Parquet stores.
REST bodies and responses use protobuf JSON: dates are `{year, month, day}`, times
are `{hours, minutes}`, enums use their symbolic names, and int64 values are strings.
Voice methods are RPC-only, as specified by the protos.

Task and check-in PATCH requests accept `updateMask` (comma-separated camelCase
fields; snake_case query names and mask paths also work). An omitted mask changes
only supplied writable fields. A masked unset field clears it; `tags` replaces the
whole list. Supply the returned `etag` to reject intervening edits. List endpoints
return `nextPageToken`; pass it back with the same filters and ordering.
Task filters accept comparisons on `state` and `due_date` joined by `AND`;
message filters accept comparisons on `sender` and `receive_time`.

The home UI uses `/v1/home`, the new completion action, and VoiceService.AddTask
for natural-language capture. Healthstrap uploads protobuf JSON to
`/v1/streams/<stream>:mergeSamples`. Deploy this server before updating healthstrap.
The previous `/api/...` routes remain available for older clients.

Run `bun run proto:generate` after changing protos. Generated TypeScript, including
Google API and date/time descriptors, is checked in under `src/gen`.
