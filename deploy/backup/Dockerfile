# restic plus cron and sqlite3 (for consistent copies of SQLite databases).
FROM restic/restic:0.19.1
RUN apk add --no-cache sqlite tzdata
COPY backup.sh /usr/local/bin/backup.sh
COPY run.sh /usr/local/bin/run.sh
RUN chmod 755 /usr/local/bin/backup.sh /usr/local/bin/run.sh
ENTRYPOINT ["/usr/local/bin/run.sh"]
