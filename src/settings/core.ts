// The core settings table: one row of values that used to live in .env. Reading and writing
// them comes with the Settings API (S3, S4); this module only owns the schema.

import { SettingsStore } from "./store";

SettingsStore.register("core", [
  {
    version: 1,
    up: (db) => {
      db.run(`CREATE TABLE settings (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        time_zone TEXT,
        tasks_inbox TEXT NOT NULL DEFAULT 'Inbox.md',
        tailnet_proxy TEXT,
        tailnet_logins TEXT NOT NULL DEFAULT '[]',
        update_time TEXT NOT NULL
      )`);
      db.query("INSERT INTO settings (id, update_time) VALUES (1, ?)").run(
        new Date().toISOString(),
      );
    },
  },
]);
