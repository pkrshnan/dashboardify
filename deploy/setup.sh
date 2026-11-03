#!/bin/sh
# Creates DATA_DIR and gives each folder to the user its container runs as.
# Run once with sudo, from this folder, after filling in .env:  sudo ./setup.sh
set -eu
cd "$(dirname "$0")"
DATA_DIR=$(sed -n 's/^DATA_DIR=//p' .env)
: "${DATA_DIR:?set DATA_DIR in .env}"

mkdir -p "$DATA_DIR"
# dir             owner (uid:gid)  used by
while read -r dir owner; do
  mkdir -p "$DATA_DIR/$dir"
  chown "$owner" "$DATA_DIR/$dir"
  chmod 700 "$DATA_DIR/$dir"
done <<LIST
vault           1993:1993
health-raw      1993:1993
livesync-bridge 1993:1993
couchdb         5984:5984
healthstrap     0:0
tailscale       0:0
restic-cache    0:0
foundry         1000:1000
LIST
echo "created $DATA_DIR"
