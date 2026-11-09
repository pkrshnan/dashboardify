# dashboardify

A personal dashboard for tasks, calendar events, journal entries, and health data, built around a
Markdown vault that you can also open in Obsidian or any text editor.

<img width="984" height="1026" alt="image" src="https://github.com/user-attachments/assets/97903bb0-9f37-4c31-962f-296498aceb8f" />

<img width="962" height="676" alt="image" src="https://github.com/user-attachments/assets/fe2a4a18-50d3-449b-ab17-bec97560716e" />

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
token, such as `mac:<token>`. Generate a token with `openssl rand -hex 24`. The first start
copies both into Settings (`data/settings.db`, with the token stored only as a hash); after that
you can remove them from `.env`. The default `VAULT_PATH=./vault` uses the symlink above; you can
instead set an absolute vault path. Only `VAULT_PATH` is required.

Load the configuration and start the server:

```sh
set -a
. ./.env
set +a
bun run dev
```

Open [localhost:8787](http://localhost:8787) and enter your device token. Without `INGEST_TOKENS`, the first start prints a one-time setup code instead ("No devices yet. Open … and enter setup code 4KQ7-MZ2D"); enter it on the "Set up this device" screen to add this browser. Add more devices later with `bun run settings devices add <name>`. Your vault and `.env`
are git-ignored. See [development notes](docs/development.md) for checks, demo options, and hosting.

### Connect a calendar

Open Settings (the gear beside the date) › Calendars › **Connect iCloud**, and enter your Apple
ID with an app-specific password from account.apple.com › Sign-In and Security. Your calendars
show on the home screen within a couple of minutes, and the capture box can add events to them.

To show a calendar that isn't in iCloud, such as a work calendar, add its published ICS link
under Settings › Calendars › **Calendar links**. Links are read-only and refresh every 15
minutes. The link is stored encrypted, and only its host is ever shown.

Under Settings › General › **Places**, set your town so place searches look near you first.

## Adding things

One box under the calendar heading takes events and reminders. Type a line such as
`Lunch with Sam at Dishoom tomorrow 12:30–13:30` or `Call dentist Fri 10:00`. As you type, it
highlights the time, the person and the place, and says whether the line will be an event or a
reminder and why. You can switch the kind by hand. Return adds the line, and Undo takes it back.

- **Events** go to iCloud, on the calendar the box guesses from your history and keyword rules.
  Click the calendar name to pick another.
- **Reminders** become tasks in your inbox note, with a due date and time when the line has them.
- **Places:** "at Dishoom" or "@Dishoom" is looked up on OpenStreetMap through
  [Photon](https://photon.komoot.io), and the box shows the match it found. Click "1 of 5" to
  step through the other matches. The event is saved with the address and coordinates, so Apple
  Calendar shows a map and travel time, and the dashboard shows a Map link. A place that isn't
  found is saved as typed. Set `PHOTON_URL` to use your own Photon server.

Press `N` to jump to the box. The [Add to command center](shortcuts/add-to-command-center.md)
Siri Shortcut sends lines to the same API from your phone.

## Changing events

Tap an event on the Day view to see it. **Edit** changes its title, times, location and notes;
moving the start moves the end with it. **Delete** removes it from iCloud after a confirmation.
If the event changed in Apple Calendar since the page loaded, the save is refused rather than
overwriting it. Repeating events, all-day dates and events on read-only calendars or calendar
links can't be changed here; the panel says why, and Apple Calendar can change them.

## How it works

The server exposes authenticated v1 REST and Connect APIs, with shared protobuf validation.
The home UI uses these APIs, and the updated healthstrap client uploads through the v1 stream
API.

The server reads and writes your notes through a vault layer. Tasks stay in Obsidian Tasks format
wherever you keep them; newly captured tasks go into `Inbox.md` by default. Journal entries and
check-ins go into daily notes. You can edit those files directly as well as through the app.

For health data, [healthstrap](https://github.com/pkrshnan/healthstrap) sends raw sensor samples
to the server. Samples are stored as Parquet outside the vault in `health-raw/`. The server
computes health summaries into `health-derived/` and writes daily results into the vault.
Derived health tables can be rebuilt from the raw samples.

The home screen is a Preact app served by the same process. The server combines tasks, health
history, and calendar events into a home view, and the UI renders it. The Activity page
(`#activity`) lists detected workouts and walks for review. Sign-in uses device tokens or, when
configured behind Tailscale Serve, an allowed tailnet login.

Calendars sync every two minutes over CalDAV into `data/calendar-cache.db`, so the home screen
never waits on iCloud. Writes go to iCloud first, then that calendar syncs again. The cache can be
deleted at any time and is rebuilt by the next sync. Today's events are also written into the
daily note.

Settings, devices, and calendar accounts live in `data/settings.db`. Passwords and calendar links
are encrypted with `data/secret.key`. Keep that key out of backups of the data folder and save
it somewhere safe (`bun run settings key show`); without it the stored passwords can't be read.

See the [HTTP API](docs/api.md), [vault format](docs/vault-format.md),
[health calculations](docs/health-metrics.md), and the [calendar](docs/calendar-plan.md) and
[settings](docs/settings-plan.md) plans for details. The [architecture](docs/architecture.md)
and [plan](docs/plan.md) describe the broader design and work still to come.
