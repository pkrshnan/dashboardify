// Lists your iCloud calendars through the CalDAV client, to check it against the real server:
//   APPLE_ID=you@icloud.com bun scripts/caldav-check.ts
// It asks for an app-specific password (account.apple.com › Sign-In and Security) and prints
// only calendar names, write access and whether sync works. Nothing is saved.

import { CalDavClient } from "../src/calendar/caldav";

const username = process.env.APPLE_ID;
if (!username) {
  console.error("Set APPLE_ID to your Apple ID email.");
  process.exit(1);
}
const password = prompt("App-specific password:")?.trim() ?? "";

const client = new CalDavClient({
  serverUrl: "https://caldav.icloud.com/",
  username,
  password,
  allowedDomains: ["icloud.com"],
});

const home = await client.discover();
console.log(`Calendar home on ${new URL(home).host}`);
for (const calendar of await client.listCalendars(home)) {
  const sync = await client.sync(calendar.url, undefined);
  const events = sync.kind === "changes" ? `${sync.changed.length} events` : "sync token expired";
  console.log(
    `- ${calendar.displayName} (${calendar.writable ? "writable" : "read-only"}, ${events})`,
  );
}
