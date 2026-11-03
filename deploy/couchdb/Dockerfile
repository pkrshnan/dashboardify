# CouchDB with the settings Obsidian Self-hosted LiveSync needs. The file is baked in rather than
# bind-mounted because the image's entrypoint chowns everything under /opt/couchdb at start and
# exits if it can't (a read-only mount makes it fail silently).
FROM couchdb:3.5.3
COPY livesync.ini /opt/couchdb/etc/local.d/livesync.ini
