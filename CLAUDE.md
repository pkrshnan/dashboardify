# dashboardify

A one-person command center over a Markdown vault the user also opens in Obsidian. Bun and
TypeScript: Hono server with protobuf v1 APIs, Preact web app, one process on a home server
reached over Tailscale. The user reviews every PR.

## Commands

```sh
bun run check           # lint, proto lint, typecheck, tests (what CI runs)
bun run format          # Biome fixes and import order
bun run demo            # localhost:8788 with made-up data; DEMO_TIME=09:12 pins the clock
bun run proto:generate  # after editing proto/; src/gen/ is checked in
bun run settings …      # devices, export, key, rotate-key
```

## Docs

Read the one for the area you change.

| Doc | Holds |
| --- | --- |
| [roadmap.md](docs/roadmap.md) | Decisions, what is built, what is next |
| [architecture.md](docs/architecture.md) | Code map, request flow, data on disk, security |
| [navigation.md](docs/navigation.md) | Plan N1–N8: router, modules, command bar, search, sidebar |
| [lists.md](docs/lists.md) | Plan LS1–LS4: list notes, ListService, the Lists page, Siri |
| [api.md](docs/api.md) | Every v1 endpoint and its conventions |
| [vault-format.md](docs/vault-format.md) | What the server writes into notes |
| [calendar.md](docs/calendar.md) | CalDAV, ICS links, cache and sync, capture |
| [strava.md](docs/strava.md) | Plan ST1–ST6: Strava runs, splitting walk-run-walk |
| [settings.md](docs/settings.md) | `settings.db`, secrets, devices, CLI, Settings page |
| [health-metrics.md](docs/health-metrics.md) | How each health number is computed |
| [health-feedback.md](docs/health-feedback.md) | Check-ins and re-fitting recovery |
| [health-extended.md](docs/health-extended.md) | Plan H1–H11: load, calories, VO2max, ages, sleep stages |
| [design/README.md](docs/design/README.md) | Layout rules, colour tokens, type, formats |
| [style.md](docs/style.md) | Lint rules, conventions, tests |
| [development.md](docs/development.md) | Demo, PR demos, config |

## Adding a feature

1. A plan in `docs/<feature>.md`: goals, decisions, data, API, a numbered PR list.
2. Proto → store in `src/<feature>/` → service in `src/server/api/<feature>.ts` → register in
   `src/server/routes/v1.ts` and `rest-bindings.ts` → calls in `web/api.ts` → UI.
3. The page is one `web/modules/<feature>.tsx`, listed in `web/modules/index.ts`
   ([navigation.md](docs/navigation.md#adding-a-module)). It reads the token and phone flag
   with `useApp()` and the home view from its props.
4. Update `docs/api.md`, `docs/vault-format.md` if it writes notes, and the roadmap.

## Rules that are easy to miss

- Small stacked PRs: each branch on the previous one, each passing `bun run check` with tests and
  doc updates.
- Only touch what the server owns in a note: keys it was sent, its appended lines, `cc:` blocks.
- A `- [ ]` line anywhere in the vault is a task.
- No network in tests: `test/calendar/fake-caldav.ts`, `test/places/fake-photon.ts`, and
  `useApi()` in `test/server/api/helpers.ts` for an isolated vault and `DATA_PATH`.
- Secrets go through `SecretBox`, are `INPUT_ONLY` in protos, and are never logged or returned.
- Days follow the server's time zone (`vault.timeZone`), never the machine's.
- Don't edit `src/gen/`; regenerate.
- Writing: short plain sentences, day-month dates ("3 Nov"), 24-hour times; comments say why.
