# dashboardify

A personal command center whose only source of truth is a folder of Markdown files.

Health, calendar, tasks, journal, mail and messages flow into a vault you can open in Obsidian or any editor. You can ask questions about all of it, mostly by voice through Siri. The search index and dashboard are rebuilt from the vault, so deleting the app never loses data.

**Status:** building milestone 1 (capture). See the [plan](docs/plan.md).

- [Architecture](docs/architecture.md): principles, components, sources, vault layout
- [Plan](docs/plan.md): phases, decisions so far, open questions
- [HTTP API](docs/api.md) and [vault format](docs/vault-format.md)

## Development

Requires [Bun](https://bun.sh) (version pinned in `package.json`).

```sh
bun install
bun run check   # lint + typecheck + tests, the same as CI
bun run format  # auto-fix formatting and import order
cp .env.example .env && set -a && . ./.env && set +a && bun run dev
```

See [docs/style.md](docs/style.md) for the code style.

CI runs on every pull request through GitHub Actions (`.github/workflows/ci.yml`).
