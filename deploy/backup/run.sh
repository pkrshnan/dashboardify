#!/bin/sh
# Installs the schedule and keeps cron in the foreground.
set -eu
echo "${BACKUP_SCHEDULE} /usr/local/bin/backup.sh > /proc/1/fd/1 2>&1" > /etc/crontabs/root
echo "backup scheduled: ${BACKUP_SCHEDULE} (${TZ})"
exec crond -f -l 8
