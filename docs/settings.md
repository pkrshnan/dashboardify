# Settings and secrets

Configuration that the app can edit lives in `$DATA_PATH/settings.db`, outside the vault, because
it holds secrets that must never sync. `.env` keeps only what is needed to open it. Messages are
in `proto/dashboardify/v1/{settings,device}.proto`; endpoints in [api.md](api.md). The original
PR plan (S1–S8): `git show 7d6e452:docs/settings-plan.md`.

## Decisions

| Area | Decision |
| --- | --- |
| Startup values | `.env`: `VAULT_PATH` (required), `PORT`, `DATA_PATH` (default `./data`), `SECRET_KEY_FILE`, `HEALTH_RAW_PATH`, `HEALTH_DERIVED_PATH`, `PHOTON_URL` |
| Store | `bun:sqlite` in WAL mode, so the server and the CLI can use it at once |
| Schema | Each module registers numbered migrations under its own name (`core`, `devices`, `calendar`); `core` runs first |
| Secrets | AES-256-GCM (`node:crypto`), random nonce per value, AAD `<table>/<row id>/<field>` so a sealed value can't be moved to another row |
| Key | 32 random bytes in `$DATA_PATH/secret.key` (mode 0600), made on first run, or `SECRET_KEY_FILE` |
| Device tokens | `dfy_` + 32 random bytes; only the SHA-256 hash is stored, compared in constant time; shown once |
| Secret fields | `INPUT_ONLY` in protos and never returned; responses say `<field>_set` instead |
| First run | With no devices and no tailnet sign-in, the server prints a one-time setup code (8 characters, 15 minutes, memory only) that "Set up this device" on the sign-in screen accepts, for `CreateDevice` only |

### Threat model

Encryption covers `settings.db` leaking on its own (a backup, a copied file, an export). It does
not cover someone with the whole server. So the key never travels with the database: leave
`secret.key` out of backups and keep it in a password manager (`bun run settings key show`).
Losing it means re-entering calendar passwords; device tokens keep working.

## Tables

- `schema_migrations (module, version, apply_time)`.
- `meta`: `key_check` (a sealed known string; a wrong key stops startup) and `env_imported`.
- `settings`, one row: `time_zone`, `tasks_inbox`, `tailnet_proxy`, `tailnet_logins` (JSON),
  `places_near`, `update_time` (also the etag).
- `devices`: `id` (slug of the name), `display_name`, `token_hash`, `create_time`,
  `last_used_time` (written at most once a minute). Revoking deletes the row.
- Calendar's own tables come from `src/calendar/accounts.ts`.

## Code

| File | Does |
| --- | --- |
| `src/settings/key.ts` | Load or create the key; reject other lengths |
| `src/settings/secret-box.ts` | `seal(aad, text)` and `open(aad, sealed)`; format `0x01`, 12-byte nonce, ciphertext and tag |
| `src/settings/store.ts` | Open, migrate, `transaction`, `registerSealed` for rotate-key, `version()` (`PRAGMA data_version`, so CLI writes are seen without polling) |
| `src/settings/core.ts` | The `settings` row |
| `src/settings/devices.ts` | `DeviceStore`: add, list, revoke, match a token |
| `src/settings/env-import.ts` | One-time import from `.env`, and the overrides |
| `src/settings/startup.ts` | The startup order below |
| `src/settings/setup-code.ts`, `export.ts`, `rotate.ts` | Setup code, TOML export, key rotation |
| `scripts/settings.ts` | The `bun run settings` CLI |
| `web/settings/` | The Settings page and its sections |

## Startup

1. Read the startup values; create `DATA_PATH` (0700).
2. Load or create the key. If `settings.db` exists without a key, stop rather than make one that
   can't open it.
3. Open `settings.db`, run migrations, check `key_check`.
4. Import `.env` once (logged by name, never value); apply overrides.
5. Build `Config`; print a setup code if nobody can sign in; serve.

Changes from the API or the CLI apply on the next request (devices, tailnet, inbox). A time zone
change needs a restart, and the response's `restart_required` says so.

## Moving off `.env`

The first start imports `INGEST_TOKENS` (as hashed devices), `TZ_NAME`, `TASKS_INBOX`,
`TAILSCALE_PROXY` and `TAILNET_USERS`. After that, a settings variable still set in the
environment overrides Settings with a warning, and the page shows the field read-only.
`INGEST_TOKENS` is never an override; once imported it is ignored.

## CLI

`bun run settings <command>` opens the same `settings.db`; commands are in
[development.md](development.md#settings-from-the-terminal). `rotate-key` re-seals every
registered column and `key_check` in one transaction, then swaps the key file. It refuses while
`$DATA_PATH/server.lock` is held.

## Settings page

`#settings/<section>`, from the gear beside the date. Desktop: a section list beside the
section. Phone: the list, which pushes to each section. Sections are listed in
`web/settings/sections.ts` and mapped to components in `settings.tsx`.

- **General:** time zone, tasks inbox, tailnet proxy and logins, and Places (the town place
  searches look near).
- **Devices:** list; add shows the token once with a QR code (`uqr`, in the page); revoke warns
  harder for the current device.
- **Calendars:** [calendar.md](calendar.md).

## Testing

`useApi()` in `test/server/api/helpers.ts` gives each test a temporary `DATA_PATH`, a fixed key
and device `test` with token `secret`. Crypto tests use real crypto. CLI tests spawn the script.

## Open questions

- [ ] Delete the old `data/dashboardify.db` (the pre-rebuild server's API keys; nothing reads it)?
- [ ] Pick up time zone changes without a restart?
- [ ] Block revoking the last device when there is no tailnet sign-in?
