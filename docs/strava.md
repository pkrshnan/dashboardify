# Strava plan

Runs from Strava, so a strap session of walk, run, walk is split into the run and the walks
around it, and the run gets its distance and pace. You record only the running part in Strava,
so the activity's start and length mark the run; the strap fills in the rest. Status: ST1–ST2 built
(the account and `bun run settings strava`); next, ST3.

## Goals

- A walk-run-walk outing shows as a walk, a run and a walk, each with the right minutes.
- Runs carry distance and pace from Strava.
- Strava runs become labelled minutes for checking the strap's running threshold (140 steps/min).

Not goals: routes and pace curves (streams, later), other sport types, webhooks (they need a
public URL; the server is on the tailnet only), writing to Strava.

## Decisions

| Area | Decision |
| --- | --- |
| Account | One Strava account, your own API app in single-athlete mode. Scope `activity:read_all`, so private runs count. |
| Connect | CLI only: `bun run settings strava connect` asks for the app's client ID and secret, prints the approval link with redirect `http://localhost/strava`, and takes the `code` you paste back from the address bar. `disconnect` deauthorizes and deletes the rows and cache; `status` prints the athlete and last sync. No API and no Settings section yet. |
| Secrets | Client secret, refresh token and access token sealed in `settings.db` (`strava_account`, one row), registered for `rotate-key`, left out of `export`. Strava may return a new refresh token on each refresh; it replaces the old one in the same transaction. |
| Sync | Every 30 min, `GET /athlete/activities?after=` the newest run's start minus 2 days, so late uploads and edits are seen. The first sync goes back 90 days. Well inside the read limits (about 100 per 15 min, 1,000 a day). |
| Runs | `sport_type` `Run`, `TrailRun` or `VirtualRun` (treadmill). Others are ignored. |
| Cache | `$DATA_PATH/strava-cache.db`: id, start (UTC), elapsed and moving seconds, distance, name, sport type. Disposable; deleting it means a resync. A new or changed run calls `SummaryScheduler.touchDate` for its local date. |
| Window | The run is `start_date` to `start_date + elapsed_time`, rounded to the nearest strap minute (the phone and strap clocks can differ by a minute). Pauses inside count as running. |
| Split | Before naming, a strap workout that overlaps a run is cut at the run's window. The run part is `running`, status `CONFIRMED`. The parts before and after go back to the walk finder, which takes walks of 5+ min next to a run instead of 10+. |
| No strap session | A Strava run with no workout under it still becomes a running workout, from the strap minutes in its window (HR may be missing). |
| Reviews | Unchanged: a review still applies to the workout it overlaps by half, so a review of the old whole session lands on the run. A review beats Strava. |
| Day | Local dates from `vault.timeZone`. |
| Tests | `test/strava/fake-strava.ts` for OAuth and the activity list; no network. |

## Data

- `Workout` gains `distance_meters` and `strava_activity_id` (output only). Pace is distance over
  minutes, worked out in the page.
- `workouts/` in health-derived gains the same two columns.
- The note's run line adds distance and pace:
  `- Running 10:42–11:14 · 32 min · 5.1 km · 6:16 /km · 152 avg / 171 max · strain 9.8`.

## Code

| File | Does |
| --- | --- |
| `src/strava/account.ts` | `strava_account` table and migrations; seal, refresh, replace tokens |
| `src/strava/client.ts` | Token exchange, refresh, deauthorize, activity list, over an injected `fetch` |
| `src/strava/cache.ts` | `strava-cache.db` |
| `src/strava/sync.ts` | The 30-min loop, backoff, touching changed dates |
| `src/health/metrics/runs.ts` | Pure: workouts and runs → split workouts and the spans left for walks |
| `scripts/settings.ts` | `strava connect`, `disconnect`, `status` |

## PRs

| # | Does |
| --- | --- |
| ST1 | This plan; roadmap #6 decided for Strava |
| ST2 | `strava_account`, the client with token refresh, and the CLI commands |
| ST3 | Cache and sync loop, started in `main.ts`; changed runs recompute their day |
| ST4 | `runs.ts` split, the 5-min walks next to a run, the new `workouts/` columns, the note's run line |
| ST5 | `Workout` fields; the Activity page shows distance and pace on runs and links to Strava (after artboards) |
