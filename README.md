# dashboardify

A personal dashboard for tasks, journal entries, and health data, built around a Markdown vault
that you can also open in Obsidian or any text editor.

## Getting started

Install [Bun](https://bun.sh) using the version pinned in `package.json`, then clone the repository
and install its dependencies:

```sh
git clone https://github.com/pkrshnan/dashboardify.git
cd dashboardify
bun install
```

### Try the demo

```sh
bun run demo
```

Open [localhost:8788](http://localhost:8788) and sign in with the token printed in the terminal.
The demo uses temporary notes, sample health data, and calendar events, so you can explore the
home screen without connecting a vault or a health strap.

### Use your own vault

Stop the demo, then link your vault into the checkout and copy the example configuration:

```sh
ln -s /absolute/path/to/your/vault vault
cp .env.example .env
```

Edit `.env` to set your time zone and replace `INGEST_TOKENS` with a device name and a random
token, such as `mac:<token>`. Generate a token with `openssl rand -hex 24`. The default
`VAULT_PATH=./vault` uses the symlink above; you can instead set an absolute vault path.

Load the configuration and start the server:

```sh
set -a
. ./.env
set +a
bun run dev
```

Open [localhost:8787](http://localhost:8787) and enter your device token. Your vault and `.env`
are git-ignored. See [development notes](docs/development.md) for checks, demo options, and hosting.

## How it works

The server reads and writes your notes through a vault layer. Tasks stay in Obsidian Tasks format
wherever you keep them; newly captured tasks go into `Inbox.md` by default. Journal entries and
check-ins go into daily notes. You can edit those files directly as well as through the app.

For health data, [healthstrap](https://github.com/pkrshnan/healthstrap) sends raw sensor samples
to the server. Samples are stored as Parquet outside the vault in `health-raw/`. The server
computes health summaries into `health-derived/` and writes daily results into the vault.
Derived health tables can be rebuilt from the raw samples.

The home screen is a Preact app served by the same process. The server combines tasks, health
history, and calendar events into a home view, and the UI renders it. The demo supplies a sample
calendar; the regular server starts without a calendar source. Sign-in uses device tokens or,
when configured behind Tailscale Serve, an allowed tailnet login.

See the [HTTP API](docs/api.md), [vault format](docs/vault-format.md), and
[health calculations](docs/health-metrics.md) for details. The [architecture](docs/architecture.md)
and [plan](docs/plan.md) describe the broader design and work still to come.
