# dashboardify

A personal command center whose only source of truth is a folder of Markdown files.

A small server receives data (journal lines, health metrics, reminders, messages) and writes it into a vault you can open in Obsidian or any editor. Everything else (search index, dashboard, the agent that answers questions about your data) reads from that vault and can be rebuilt from it. Delete the server and you still have all your data as plain text.

**Status:** phase 1 of 5. The ingest server and vault writer work; the dashboard at `/` is a static mock with fake data, so the layout and type can be judged before it is wired up.

## Run it

Requires [Bun](https://bun.sh) 1.4+.

```sh
cd server
bun install
cp ../.env.example ../.env   # then edit VAULT_PATH and INGEST_TOKENS
set -a; . ../.env; set +a
bun run dev                  # http://localhost:8787
```

Or with Docker:

```sh
docker build -t dashboardify .
docker run -p 8787:8787 -v /path/to/vault:/vault --env-file .env -e VAULT_PATH=/vault dashboardify
```

Try it:

```sh
curl -X POST localhost:8787/api/ingest/journal \
  -H "Authorization: Bearer $TOKEN" -H 'content-type: application/json' \
  -d '{"text":"First entry"}'
```

Tests: `cd server && bun test && bun run typecheck`.

## How it fits together

| Piece | Where | State |
| --- | --- | --- |
| Vault layout | [`example-vault/`](example-vault/) | Done |
| Ingest API + Shortcut recipes | [`server/src/app.ts`](server/src/app.ts), [`docs/ingest-api.md`](docs/ingest-api.md) | Done: journal, health, reminders, messages |
| Today dashboard | [`web/index.html`](web/index.html) | Static mock |
| Calendar (CalDAV/ICS), Whoop API | | Phase 2 |
| Index + ask agent (Claude, swappable for Ollama or any OpenAI-compatible endpoint) | | Phase 3 |
| Mail (IMAP) triage, message digests | | Phase 4 |
| Fully local models, per-source privacy routing | | Phase 5 |

Rules the code keeps:

- The vault is the source of truth. Derived data (index, embeddings) goes in `.cc/` inside the vault and is disposable.
- The server only edits the regions it owns: frontmatter keys it was sent, the `## Journal` list, and `<!-- cc:name -->` blocks. Your own text is never rewritten.
- Writes are atomic (temp file + rename), so Obsidian or a sync tool never sees half a file.
- Files from private sources carry `privacy: local-only` and will never be sent to a cloud model.
