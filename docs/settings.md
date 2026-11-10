# Settings and secrets

How configuration lives outside `.env`: `settings.db` for settings and devices, a secret box for
passwords, the CLI and the Settings page. Built as S1–S8 (PRs #37–#52); the PR-by-PR plan is in
git history (`git show 7d6e452:docs/settings-plan.md`). [Calendar](calendar.md) builds on the
store, the secret box and the Settings page described here. New features add their own tables
(a migration registered under the module's name) and their own Settings section.

## Goals

- `.env` holds only what the server needs before it can open anything.
- Devices, sign-in and general settings are added, changed and revoked from the app or a CLI,
  without editing files or restarting.
- Secrets the server must use (calendar and mail passwords, later) are encrypted at rest.
  Secrets it only checks (device tokens) are stored as hashes.
- Later features (calendar, mail) add their own tables and Settings sections without changing
  this core.

## Non-goals

- Multiple users, roles or per-device scopes. Every device can do everything, as today.
- Protection against someone with full access to the server.
- Syncing settings between servers, or keeping them in the vault.
- A settings UI for paths and the port. Those stay in `.env`.

## Decisions

| Area | Decision | Why |
| --- | --- | --- |
| Startup config | `.env` keeps `DATA_PATH` (default `./data`), `VAULT_PATH` and `PORT`, plus optional `SECRET_KEY_FILE`. `HEALTH_RAW_PATH` and `HEALTH_DERIVED_PATH` stay as optional path overrides with their current defaults. | These are needed before the settings store opens. Paths are deployment details, not settings. |
| Settings store | `$DATA_PATH/settings.db`, `bun:sqlite`, WAL mode | Built into Bun, no new dependency. Safe for the server and the CLI to use at once. |
| Where | Outside the vault | The vault syncs to every device through LiveSync, and secrets must never be in the vault. |
| Feature tables | A migration registry: each module registers numbered migrations under its own name | The calendar and mail modules own their schema and don't edit a central migration list. |
| Encrypted secrets | AES-256-GCM through `node:crypto`, one random nonce per value, AAD names the row and field | Built into Bun and synchronous, unlike WebCrypto, so reads stay simple. The AAD stops a sealed value being copied into another row or field. |
| Key | 32 random bytes in `$DATA_PATH/secret.key`, mode 0600, made on first run. `SECRET_KEY_FILE` can point at a Docker or systemd secret instead. | No setup step, and it works with container secrets. |
| Device tokens | SHA-256 hash only, compared in constant time. The token is shown once, when the device is added. | The server never needs a token back, so it never stores one. |
| API | `SettingsService` (a singleton `settings`) and `DeviceService` (`devices/{device}`), in the existing AIP style | Same transports, validation and tests as the other v1 services. |
| Secret fields | `INPUT_ONLY` and never returned. Responses carry `<field>_set` and `last_used_time` instead. | You can replace a secret but never read it back. |
| Readable copy | `bun run settings export` writes everything except secrets as TOML | Keeps the spirit of "files are the source of truth": settings can be diffed and backed up. |
| Moving off `.env` | Import once on first start, then env values override for one release with a warning | Nothing breaks on upgrade, and the warning says what to remove. |
| First run | With no devices and no tailnet sign-in, print a one-time setup code | You can sign in and add the first device without the CLI. |

### Threat model

Encryption protects against the settings database leaking on its own: a restic snapshot in R2,
a copied file, or an export. It does not protect against someone with full access to the server,
who can read both the database and the key. Hardware keys or a separate secrets service would
cover that, which is too much for a one-person server reached over Tailscale.

So the key must not travel with the database:

- Exclude `secret.key` from the restic backup of `DATA_PATH`. Also exclude derived files such
  as `calendar-cache.db`, which are rebuilt on start.
- Store the key once in a password manager. `bun run settings key show` prints it for that.
- Losing the key means re-entering calendar and mail passwords. Device tokens keep working,
  because they are hashes.

## Data model

All times are RFC 3339 UTC strings. Ids are lower-case slugs.

**`schema_migrations`**: one row per applied migration.

| Column | Type | Notes |
| --- | --- | --- |
| module | TEXT | `core`, `devices`, `calendar`, … |
| version | INTEGER | Starts at 1 per module |
| apply_time | TEXT | |

Primary key `(module, version)`.

**`meta`**: small values the store itself needs.

| Key | Value |
| --- | --- |
| `key_check` | A sealed known string (AAD `meta/key_check/value`). Opening it at startup proves the key matches the database. |
| `env_imported` | Time the `.env` import ran, so it runs once. |

**`settings`**: exactly one row (`id = 1`).

| Column | Type | Notes |
| --- | --- | --- |
| time_zone | TEXT | IANA zone, checked with `Intl` on write |
| tasks_inbox | TEXT | Vault-relative path, default `Inbox.md` |
| tailnet_proxy | TEXT | IP or `gateway`, or NULL |
| tailnet_logins | TEXT | JSON array of logins |
| update_time | TEXT | Also the etag |

**`devices`**

| Column | Type | Notes |
| --- | --- | --- |
| id | TEXT PRIMARY KEY | From the name: "Pranav's iPhone" → `pranavs-iphone` |
| display_name | TEXT | |
| token_hash | BLOB UNIQUE | SHA-256 of the token |
| create_time | TEXT | |
| last_used_time | TEXT | Written at most once a minute per device |

Revoking deletes the row. Tokens are 32 random bytes, base64url, prefixed `dfy_` so they are
easy to spot in logs and secret scanners.

Calendar adds `calendar_accounts` and `calendars` through its own migration (`src/calendar/accounts.ts`).

## Module layout

```
src/settings/
  key.ts            load SECRET_KEY_FILE, or create 32 bytes with mode 0600; reject other lengths
  secret-box.ts     SecretBox: seal(aad, plaintext) and open(aad, sealed)
  store.ts          SettingsStore: open, migrations, transaction(fn), sealed-column registry
  core.ts           migrations for schema_migrations, meta and settings; get and update settings
  devices.ts        DeviceStore: add, list, revoke, match(token)
  env-import.ts     one-time import from .env, plus the per-release overrides
  setup-code.ts     the one-time first-run code, held in memory
  export.ts         TOML export without secrets
src/server/api/settings.ts, devices.ts   v1 services
scripts/settings.ts                       the `bun run settings` CLI
web/settings/                             Settings page shell and sections
```

### Store and secret box

```ts
interface Migration { version: number; up: (db: Database) => void }

class SettingsStore {
  static open(dataPath: string, box: SecretBox): SettingsStore;
  /** Run before open() finishes; modules call this at import time. */
  static register(module: string, migrations: Migration[]): void;
  /** For rotate-key: which BLOB columns hold sealed values, and how to build their AAD. */
  static registerSealed(table: string, idColumn: string, columns: string[]): void;
  transaction<T>(fn: (db: Database) => T): T;
  /** Changes whenever another connection (the CLI) writes; caches compare it. */
  version(): number;
}

class SecretBox {
  seal(aad: string, plaintext: string): Uint8Array;
  open(aad: string, sealed: Uint8Array): string;
}
```

- The sealed format is version byte `0x01`, then a 12-byte random nonce, then ciphertext plus the
  16-byte tag. An unknown version byte, a wrong AAD or a changed byte throws the same error.
- AAD is `<table>/<row id>/<field>`, for example `calendar_accounts/icloud/password`.
- Each migration runs in its own transaction and is recorded in the same one. Modules migrate in
  registration order, with `core` first.
- `version()` reads `PRAGMA data_version`, so the server notices CLI writes without polling the
  tables.

Neither `node:crypto` ciphers nor `bun:sqlite` are used elsewhere in the repo yet, so this PR also
gives them a small, well-tested home.

## API

```proto
// settings.proto
service SettingsService {
  rpc GetSettings(GetSettingsRequest) returns (Settings) {
    option (google.api.http) = {get: "/v1/{name=settings}"};
  }
  rpc UpdateSettings(UpdateSettingsRequest) returns (Settings) {
    option (google.api.http) = {patch: "/v1/{settings.name=settings}" body: "settings"};
  }
}

message Settings {
  // type "dashboardify.app/Settings", pattern "settings"
  string name = 1 [(google.api.field_behavior) = IDENTIFIER];   // always "settings"
  string time_zone = 2;                                          // IANA, validated
  string tasks_inbox = 3;
  Tailnet tailnet = 4;
  google.protobuf.Timestamp update_time = 5 [OUTPUT_ONLY];
  string etag = 6;
  // Fields still set from the environment, which win until removed from .env.
  repeated string env_overrides = 7 [OUTPUT_ONLY];
  // Fields changed by the last update that apply only after a restart.
  repeated string restart_required = 8 [OUTPUT_ONLY];
}

message Tailnet {
  string proxy = 1;                    // IP address or "gateway"
  repeated string allowed_logins = 2;
}

message UpdateSettingsRequest {
  Settings settings = 1 [REQUIRED];
  google.protobuf.FieldMask update_mask = 2;
}
```

```proto
// device.proto
service DeviceService {
  rpc CreateDevice(CreateDeviceRequest) returns (Device) {
    option (google.api.http) = {post: "/v1/devices" body: "device"};
  }
  rpc ListDevices(ListDevicesRequest) returns (ListDevicesResponse) {
    option (google.api.http) = {get: "/v1/devices"};
  }
  rpc DeleteDevice(DeleteDeviceRequest) returns (google.protobuf.Empty) {
    option (google.api.http) = {delete: "/v1/{name=devices/*}"};
  }
}

message Device {
  // type "dashboardify.app/Device", pattern "devices/{device}"
  string name = 1 [IDENTIFIER];
  string display_name = 2 [REQUIRED];
  google.protobuf.Timestamp create_time = 3 [OUTPUT_ONLY];
  google.protobuf.Timestamp last_used_time = 4 [OUTPUT_ONLY];
  // Set only in the CreateDevice response. Never stored or returned again.
  string token = 5 [OUTPUT_ONLY];
  // True for the device making this request, so the UI can warn before revoking it.
  bool current = 6 [OUTPUT_ONLY];
}
```

`CreateDevice` takes a `request_id` like `CreateTask`. Settings has no secret fields yet. The
`INPUT_ONLY` plus `<field>_set` pattern is first used by `CalendarAccountService`; a shared test
helper added here asserts that no response JSON contains a value written to an `INPUT_ONLY`
field, so every later service can use it.

A time zone change takes effect after a restart in the first version, because the vault and
schedulers take it at construction. The response lists `time_zone` in a `restart_required` field
and the page says so. The tasks inbox and tailnet sign-in take effect at once.

## Auth changes

- `bearerAuth` takes a `DeviceStore` instead of a token map. It hashes the bearer token and
  compares it in constant time against every stored hash, as `matchDevice` does today. The list
  is cached and reloaded when `store.version()` changes, so a revoke from the CLI applies on
  the next request.
- Tailnet sign-in reads the proxy and logins from settings through the same cache.
- `c.set("device", …)` keeps the device id, or `tailnet:<login>` as today.
- A setup code, while one exists, is accepted only on `CreateDevice`.

## Startup order

1. Read `DATA_PATH`, `VAULT_PATH`, `PORT`, `SECRET_KEY_FILE` and the path overrides.
2. Create `DATA_PATH` with mode 0700 if needed.
3. Load the key, or create it. If `settings.db` exists but the key file doesn't, stop with an
   error rather than make a new key that can't open existing secrets.
4. Open `settings.db` and run every registered migration.
5. Open `meta.key_check`. If it fails, stop: "secret.key doesn't match settings.db".
6. If `env_imported` is unset, import `.env` and log each moved value by name, never by value.
7. Apply env overrides in memory, warning once for each.
8. Build `Config` from settings and the startup values.
9. If there are no devices and no tailnet sign-in, make a setup code and print it.
10. `createApp`, then serve.

## Moving off `.env`

| Env var | Goes to | Notes |
| --- | --- | --- |
| `INGEST_TOKENS` | `devices`, hashed | Device name from the entry. Existing tokens keep working, so phones and Shortcuts need no change. |
| `TZ_NAME` | `settings.time_zone` | |
| `TASKS_INBOX` | `settings.tasks_inbox` | |
| `TAILSCALE_PROXY`, `TAILNET_USERS` | `settings.tailnet` | |

Existing tokens shorter than the new 32 bytes are imported as they are, since they already meet
today's 16-character minimum. New tokens are always 32 bytes. For one release, a variable still
set in the environment wins and logs "TZ_NAME is set in the environment and overrides Settings.
Remove it from .env." `Settings.env_overrides` lists them so the page can show the same thing.
`INGEST_TOKENS` is only imported, never an override: once imported, devices come from the store.
A follow-up PR removes the overrides.

## First run

When there are no devices and no tailnet sign-in, the server prints:

```
No devices yet. Open http://localhost:8787 and enter setup code 4KQ7-MZ2D (valid 15 minutes).
```

The code is 8 characters from an alphabet without look-alikes, kept in memory only, and expires
after 15 minutes or one use. A restart prints a new one. The sign-in screen gets "Set up this
device": enter the code and a device name, and the page calls `CreateDevice` with the code as
its bearer token, saves the new token and signs in.

## CLI

`bun run settings <command>` opens the same `settings.db` directly. It needs filesystem access to
`DATA_PATH`, which already implies full control of the server.

| Command | Does |
| --- | --- |
| `export [--out file]` | TOML of settings, devices (names and times only) and later feature tables. Sealed columns are written as `"<set>"`. |
| `devices add <name>` | Prints the new token once |
| `devices list` | Names, created and last used |
| `devices revoke <id>` | |
| `key show` | Prints the key as base64, for the password manager |
| `rotate-key` | New key, re-seals every registered sealed column and `key_check` in one transaction, then replaces the key file through a temporary file and rename. Refuses while the server is running. |

The server holds `$DATA_PATH/server.lock` (its pid) while running, which is how `rotate-key`
knows to refuse. TOML is written by a small serializer in `src/settings/export.ts`.

## Settings page

Settings is the `#settings` view (`#settings/<section>`), opened from a gear button next to
the date. The shell is a section list and a content pane on desktop, and a list that pushes to
each section on the phone:

```ts
// web/settings/sections.ts
export const SECTIONS: SettingsSection[] = [
  { id: "general", title: "General" },
  { id: "devices", title: "Devices" },
  { id: "calendars", title: "Calendars" },
];
// web/settings/settings.tsx maps each id to its component in VIEWS.
```

- **General:** time zone (a searchable list of IANA zones, restart note), tasks inbox, tailnet
  proxy and allowed logins, and Places (the town place searches look near first). Fields set from the environment are shown read-only with the
  override note.
- **Devices:** list with name, created and last used. Add device asks for a name, then shows the
  token once, a copy button and a QR code for the iPhone, with "You won't see this again."
  Revoke asks for confirmation and warns harder for the current device. The QR code uses a small
  client-side encoder (`uqr`); no data leaves the page.

## Testing

- No network. Everything runs against a temporary `DATA_PATH` and vault.
- `useApi()` in `test/server/api/helpers.ts` makes a temp `DATA_PATH`, opens the store with a
  fixed test key and seeds device `test` by inserting the hash of `secret`, so existing tests
  keep their `Bearer secret` header.
- A `useSettings()` helper gives store-level tests the same isolation without the HTTP app.
- Crypto tests use the real WebCrypto, never a mock.
- CLI tests spawn the script; they don't import its internals.

## Open questions

- [ ] Delete the old `data/dashboardify.db` (the pre-rebuild Go server's API keys; nothing reads
      it), or keep it as a reference?
- [ ] Is a restart for time zone changes acceptable for now, or should the vault and
      schedulers pick it up live?
- [ ] Should revoking the device you're using be allowed at all, or blocked when it is the last
      device and there is no tailnet sign-in?
- [ ] Where does `DATA_PATH` live on the home server, and does the restic job already cover it?
      The key exclusion has to be added in `pkrshnan/homeserver`.
