# Home server

One docker compose project runs everything on the Arch server:

| Service | What it is | Reachable at |
| --- | --- | --- |
| `tailscale` | Puts the server on your tailnet and serves the private services over HTTPS | your tailnet |
| `dashboardify` | The command center server, built from this checkout | `https://<TS_HOSTNAME>.<tailnet>.ts.net` |
| `couchdb` | Sync server for Obsidian Self-hosted LiveSync | `https://<TS_HOSTNAME>.<tailnet>.ts.net:8443` |
| `livesync-bridge` | Mirrors the LiveSync database to `DATA_DIR/vault` as plain files | internal |
| `healthstrap` | Syncs the WHOOP strap over the host's Bluetooth, uploads to dashboardify | internal |
| `backup` | Nightly restic snapshots to Cloudflare R2 | internal |
| `foundry` + `cloudflared` | FoundryVTT, public through a Cloudflare Tunnel | `https://<FOUNDRY_HOSTNAME>` |

Only Foundry is on the internet. The private services listen on `127.0.0.1` and are reached
through `tailscale serve`, never the LAN. Foundry and cloudflared sit on their own Docker network
and can't reach the private services.

Each service's settings live in `services/<name>.yaml`; `compose.yaml` just lists them. All data
lives under `DATA_DIR` (default `/srv/homeserver`), one folder per service.

## Install

```sh
sudo pacman -S --needed docker docker-compose docker-buildx bluez bluez-utils
sudo systemctl enable --now docker bluetooth
sudo usermod -aG docker "$USER"   # log out and back in

git clone https://github.com/pkrshnan/dashboardify && cd dashboardify/deploy
cp .env.example .env              # fill it in; see the sections below
sudo ./setup.sh                   # creates DATA_DIR with the right owners
docker compose up -d --build
docker compose ps                 # everything should say "running" or "healthy"
```

`.env` holds every secret and is git-ignored. Generate tokens and passwords with
`openssl rand -hex 24`.

Day to day:

```sh
docker compose logs -f healthstrap     # follow one service
git pull && docker compose up -d --build   # update dashboardify and restart what changed
docker compose pull && docker compose up -d   # update the third-party images
```

Docker starts the stack again on boot, because every service is `restart: unless-stopped`.

## Tailscale

1. In the [admin console](https://login.tailscale.com/admin/dns), turn on MagicDNS and HTTPS
   certificates.
2. Make an auth key under Settings > Keys and put it in `TS_AUTHKEY`. It's only used for the
   first login; the node's identity is kept in `DATA_DIR/tailscale`.

The container uses host networking, so the server itself joins the tailnet as `TS_HOSTNAME`
(you can `ssh` to it over Tailscale too). Routes are in [`tailscale/serve.json`](tailscale/serve.json).

If Tailscale is already installed on the host with pacman, use one or the other. Either
`sudo systemctl disable --now tailscaled` and let the container take over, or delete the
`services/tailscale.yaml` line from `compose.yaml` and add the same routes on the host:

```sh
sudo tailscale serve --bg --https=443 http://127.0.0.1:8787
sudo tailscale serve --bg --https=8443 http://127.0.0.1:5984
```

## Vault (Obsidian LiveSync)

Your devices sync with CouchDB; `livesync-bridge` keeps `DATA_DIR/vault` in step with it, and
that folder is the vault dashboardify reads and writes.

1. Start the stack. CouchDB is at `https://<TS_HOSTNAME>.<tailnet>.ts.net:8443` with
   `COUCHDB_USER` and `COUCHDB_PASSWORD`.
2. On the Mac with your existing vault, install Self-hosted LiveSync and point it at that URL,
   with database `LIVESYNC_DATABASE`. Turn on end-to-end encryption with `LIVESYNC_PASSPHRASE`.
   If you turn on path obfuscation, set `LIVESYNC_OBFUSCATE_PASSPHRASE` to the same value;
   otherwise leave it empty.
3. In LiveSync's settings, set **Unicode path identity** to **Legacy path identity**. The
   bridge doesn't support the newer NFC setting.
4. Let LiveSync upload the vault, then `docker compose restart livesync-bridge`. The vault
   should appear in `DATA_DIR/vault` within a minute.
5. Add the phone with LiveSync's setup URI from the Mac.

Until step 4 the bridge has no database to read and keeps restarting; that's expected.

## Bluetooth (healthstrap)

The container drives the host's BlueZ through `/run/dbus/system_bus_socket`, so pairing happens
on the host, once. Follow "Pairing" in the
[healthstrap README](https://github.com/pkrshnan/healthstrap#pairing-once-per-computer).

Run only this container or healthstrap's systemd unit, never both: the strap holds one
connection, so two daemons would fight over it. If you installed the unit earlier:
`sudo systemctl disable --now healthstrap`. To move its history over, copy
`/var/lib/private/healthstrap/healthstrap.db` into `DATA_DIR/healthstrap/`.

`HEALTHSTRAP_TOKEN` is added to dashboardify's tokens for you. To build from a local checkout
instead of GitHub, set `HEALTHSTRAP_SRC` to its path.

## FoundryVTT

1. In Cloudflare Zero Trust > Networks > Tunnels, create a tunnel ("cloudflared" connector).
   Copy the token from the install command into `CLOUDFLARE_TUNNEL_TOKEN`.
2. Give the tunnel a public hostname, for example `foundry.example.com`, with service
   `http://foundry:30000`. Put the hostname in `FOUNDRY_HOSTNAME`.
3. Set `FOUNDRY_USERNAME` and `FOUNDRY_PASSWORD` to your foundryvtt.com login; the container
   uses them once to download the release you're licensed for. `FOUNDRY_ADMIN_KEY` is the
   password for Foundry's setup screen.

`FOUNDRY_MAJOR` picks the Foundry version (default 14). If your worlds are on 13, set it to 13
until you're ready to migrate. To move existing data in, stop Foundry and copy your old `Data`
folder to `DATA_DIR/foundry/Data`, owned by uid 1000.

## Backups

Every night at `BACKUP_SCHEDULE` (03:30 by default), restic snapshots everything under the
backup container's `/data`: the vault, `health-raw`, healthstrap's database and Foundry's data
(without its cached installer). SQLite databases are copied with `sqlite3 .backup` first, so the
snapshot never catches one mid-write. Snapshots are kept for 7 days, 4 weeks and 12 months, and
each run checks 1% of the stored data.

Setup: create an R2 bucket, then an R2 API token with Object Read & Write on that bucket. Fill
in `RESTIC_REPOSITORY`, `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`. Keep `RESTIC_PASSWORD`
somewhere off the server (a password manager); without it the backups can't be read. The first
run creates the repository.

```sh
docker compose exec backup backup.sh              # back up now
docker compose exec backup restic snapshots       # list snapshots
```

Restore into an empty folder, then copy back what you need with the service stopped:

```sh
docker compose run --rm -v /tmp/restore:/restore --entrypoint restic backup \
  restore latest --target /restore
# Files land in /tmp/restore/data/<folder>; SQLite copies in /tmp/restore/sqlite/data/<folder>.
docker compose stop dashboardify livesync-bridge
sudo rsync -a /tmp/restore/data/vault/ "$DATA_DIR/vault/"
docker compose start dashboardify livesync-bridge
```

CouchDB itself isn't backed up: the vault folder is the copy that matters, and LiveSync can
rebuild the database from it (Rebuild everything, from the Mac).

## Add a service

1. Write `services/<name>.yaml` with the service (copy one of the others to start).
2. Add a line for it to `compose.yaml`.
3. Put its data in `${DATA_DIR}/<name>`, and add that folder to `setup.sh` with the user the
   container runs as.
4. If it's private, publish its port on `127.0.0.1` only and add a route to
   `tailscale/serve.json` (Tailscale serves HTTPS on ports 443, 8443 and 10000; for more, use
   paths like `/name`). If it's public, put it on a Cloudflare Tunnel like Foundry.
5. If its data should be backed up, mount it into the `backup` service under `/data`.
6. `docker compose up -d --build`.
