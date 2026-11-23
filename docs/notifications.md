# Notifications plan

Reminders on the phone from the home screen app: a calendar event 1 hour and 10 minutes before
it starts, and a task at its due time. The server sends them with Web Push, so they arrive while
the app is closed. Status: planned (NT1–NT7).

## Goals

- Never miss an event or a timed task, with the phone locked and the app closed.
- Tap a reminder and land on the thing: the event panel, or the task.
- Turn it on per device in Settings, with a test button to check it works.

Not goals: buttons on the notification (iOS doesn't show Web Push actions), snooze, quiet hours,
mail and messages, a relay like ntfy.

## Decisions

| Area | Decision |
| --- | --- |
| Delivery | Web Push (RFC 8030) straight to the browser's push service (Apple's for iPhone). iOS 16.4+ allows it only for the app added to the home screen, after the user taps a button. Android and desktop browsers work too. |
| Crypto | Written here on `node:crypto`: VAPID (RFC 8292, an ES256 JWT) and `aes128gcm` payload encryption (RFC 8291). About 150 lines, tested against the RFC's example, so no dependency. |
| Keys | One VAPID key pair, made on first use. The private key is sealed in `settings.db`; the public key is served for subscribing. The JWT's `sub` is the app's own address. |
| Subscriptions | One per browser, belonging to the signed-in device (`devices/x` or `tailnet:<login>`), named by a hash of its endpoint so the browser can find its own. Endpoint and keys are sealed. Any signed-in device can list and remove them, as with devices. Revoking a device drops its subscriptions; a `404` or `410` from the push service drops that one. |
| Push services | Only `https:` endpoints on Apple's, Google's, Mozilla's and Microsoft's push hosts, so a device can't point the server at the home network. |
| Events | Timed events only, at each offset before the start: 60 and 10 minutes by default. All-day events get none. |
| Tasks | Open tasks with a due date and time, at that time. Tasks with only a date get none. |
| Settings | One set for every device: event offsets (minutes, up to three) and tasks on or off. |
| Checking | Every 30 seconds, events from the calendar cache and tasks from the vault. A reminder's moment passing fires it once; a sent log in `settings.db`, pruned after two days, stops repeats across restarts. |
| Late | Up to 15 minutes late still sends (a restart, a sync that brought the event late), but never after an event has started. If two offsets passed together, only the nearer one goes. |
| Changes | A moved event or task gets new reminders, keyed by id and time. One already sent isn't taken back. |
| Text | Event: the title, then "In 10 min · 10:00–10:30 · Room 4". Task: the text, then "Due 09:00". 24-hour times in the server's time zone; the minutes are counted, so a late one says "In 6 min". |
| Grouping | Tag `event:<id>:<start>`, so the 10-minute reminder replaces the 1-hour one; `task:<ref>` for tasks. |
| Tap | Opens `#/?event=events/<id>` or `#/lists/tasks`, focusing the open app if there is one. |
| Delivery limits | Urgency `high`. TTL: until the event starts; an hour for tasks. |
| Service worker | `web/public/sw.js`, plain JavaScript served at `/sw.js` without a token. It shows pushes and handles taps; nothing is cached offline. |
| Privacy | The payload is encrypted for the device; the push service sees only its size and time. |

## API

`NotificationService` in `proto/dashboardify/v1/notification.proto`, listed in [api.md](api.md):

- `GetNotificationSettings`, `UpdateNotificationSettings`: offsets, tasks on or off, and the
  public key.
- `CreatePushSubscription`, `ListPushSubscriptions`, `DeletePushSubscription`: the endpoint and
  keys are `INPUT_ONLY`; a listed one shows its device, browser and create time.
- `TestNotification`: sends "Notifications work" to the caller's subscriptions now.

## Settings page

A Notifications section: Turn on for this device (with a note when an iPhone isn't using the
home screen app), the devices getting them, event reminder times, task reminders on or off, and
Send a test. Built after the artboard is approved.

## Build plan

| # | PR | Scope | Tests |
| --- | --- | --- | --- |
| NT1 | Plan | This doc, CLAUDE.md, roadmap | |
| NT2 | Web Push | `src/notifications/web-push.ts`: keys, VAPID JWT, `aes128gcm`, `send` with fetch passed in | RFC 8291 example; the JWT verifies with the public key; `410` reads as gone |
| NT3 | Subscriptions and settings | Proto, `src/notifications/push-store.ts` (migrations, sealed columns), the service, revoking a device; api.md, settings.md | Sealed at rest; unknown push hosts refused; revoke drops them; test send |
| NT4 | Reminders | `src/notifications/reminders.ts`: what is due between two moments, and its text | Offsets; late but before the start; two offsets at once; all-day and dateless skipped; done tasks; a moved event; time zone |
| NT5 | Sender | `src/notifications/scheduler.ts`: the 30-second check, the sent log, sending to every subscription; `main.ts` | Fake clock and push service: once per reminder, across a restart, gone subscriptions dropped |
| NT6 | Service worker | `web/public/sw.js`, the `/sw.js` route, registration in `app.tsx`; Today opens the event panel from `?event=` | Push shows the payload; a tap focuses or opens the address |
| NT7 | Settings section | The Notifications section on the artboard; `web/api.ts` calls | Turn on, off, test, change times |

## Open questions

- [ ] Use an event's own alarms from iCloud instead of fixed offsets, when it has any?
- [ ] A morning summary of the day's events and tasks, as one notification?
