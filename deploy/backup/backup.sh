#!/bin/sh
# One backup run: snapshot /data, apply the retention policy, and check a slice of the data.
set -eu

# First run against an empty bucket: create the repository.
restic cat config > /dev/null 2>&1 || restic init

# SQLite files can be mid-write, so back up a consistent copy of each one instead, made with
# sqlite3's online backup. /data/x/app.db is saved as /sqlite/data/x/app.db.
staging=/sqlite
rm -rf "$staging" && mkdir -p "$staging"
find /data -name '*.db' -type f | while read -r db; do
  out="$staging${db}"
  mkdir -p "$(dirname "$out")"
  sqlite3 "file:${db}?mode=ro" ".backup '${out}'"
done

restic backup --host homeserver --tag nightly \
  --exclude '/data/**/*.db' --exclude '/data/**/*.db-wal' --exclude '/data/**/*.db-shm' \
  --exclude /data/foundry/container_cache \
  /data "$staging"

restic forget --host homeserver --keep-daily 7 --keep-weekly 4 --keep-monthly 12 --prune
restic check --read-data-subset=1%
rm -rf "$staging"
echo "backup finished $(date -Iseconds)"
