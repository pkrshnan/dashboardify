#!/bin/sh
# Builds livesync-bridge's config.json from the environment, so every secret stays in .env.
# Passwords and passphrases are written into JSON as-is: keep them to letters and digits
# (openssl rand -hex 24 is fine).
set -eu

cat > /app/dat/config.json <<JSON
{
  "peers": [
    {
      "type": "couchdb",
      "name": "couchdb",
      "group": "vault",
      "database": "${LIVESYNC_DATABASE}",
      "username": "${COUCHDB_USER}",
      "password": "${COUCHDB_PASSWORD}",
      "url": "http://couchdb:5984",
      "passphrase": "${LIVESYNC_PASSPHRASE}",
      "obfuscatePassphrase": "${LIVESYNC_OBFUSCATE_PASSPHRASE}",
      "baseDir": "",
      "useRemoteTweaks": true
    },
    {
      "type": "storage",
      "name": "vault",
      "group": "vault",
      "baseDir": "./data/vault/",
      "scanOfflineChanges": true,
      "ignore": ["**/.obsidian/**", "**/.trash/**"]
    }
  ]
}
JSON

cd /app
exec deno task run
