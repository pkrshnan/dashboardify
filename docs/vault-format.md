# Vault format

Exactly what the server writes, so you can read or edit the files by hand without breaking anything.

## Rules

- The server only touches what it owns: frontmatter keys it was sent, lines it appends to `## Journal` and `## Received`, and regions between `<!-- cc:name -->` and `<!-- /cc:name -->`. Everything else in a file is left exactly as it is.
- Every write is atomic (temp file, then rename), and writes to the same file never overlap.
- A write that would not change a file is skipped, so sync and backups only see real changes.
- Days follow the server's time zone (`TZ_NAME`), so a line logged at 23:30 lands in that day's note, even around daylight saving changes.

## Daily note: `daily/YYYY/YYYY-MM-DD.md`

```markdown
---
date: 2026-11-02
tags:
  - daily
recovery: 41
sleep_h: 5.9
---
# 2026-11-02

## Journal

- 07:55 Gym felt heavy.
- 22:10 Long day. Lease still not signed.
  Second line of the same entry.
```

Health metrics are merged into the frontmatter, and a short Health block sits under the title (see below). Journal entries are `- HH:MM text`, and continuation lines are indented two spaces.

## Health in the daily note

The server computes these from the strap a couple of minutes after each upload, and hourly for today. See [health metrics](health-metrics.md) for how each number is calculated.

```markdown
---
recovery_pct: 62
strain: 11.4
sleep_score: 84
sleep_performance_pct: 90
tst_min: 432
rhr_bpm: 52
rmssd_ms: 48
resp_rate_bpm: 14.2
temp_dev_c: 0.2
steps: 8412
---
# 2026-11-02

<!-- cc:health -->
## Health

- Recovery **62%**
- Sleep **84** · 7h 12m of 8h 00m · 23:41–07:05
- RHR 52 · HRV 48 ms · Breathing 14.2 · Skin +0.2 °C
- Strain **11.4** · Zones 42 / 18 / 6 / 0 / 0 min
- Volleyball 20:30–21:15 · 45 min · 138 avg / 179 max · strain 8.3
- Walk 16:01–16:28 · 27 min · 2,790 steps · 104 spm
- Steps 8,412
- Synced 07:58
<!-- /cc:health -->

## Journal
```

- The night is the one that ended that morning. Strain, zones, workouts and steps cover the calendar day.
- Each workout is a line: running, walking, volleyball, lifting, or plain workout when it fits none. A workout the strap isn't sure of ends its name with a question mark, such as `- Lifting? 18:07–18:31`: lifting with no lifting log that day, or a workout of unknown kind. Review it on the Activity page. Workouts need resting and max HR, like strain. Walks are 10+ minutes of steady stepping outside workouts, and need only the step counter.
- Recovery shows "calibrating" until there are 14 nights of history.
- Synced is the newest strap sample, on today's note only, refreshed hourly. Once it is over two
  hours old it reads `- Synced 1 Nov 21:40 · **14h behind**`, and today gets the block even before
  any of its own data arrives.
- Strain needs `birth_date` (or `hr_max_measured`) in `profile.md` at the vault root; `sex` picks the strain constants:

  ```markdown
  ---
  birth_date: 1996-05-01
  sex: male
  hr_max_measured: 192   # optional, beats the age formula
  sleep_need_h: 8        # optional, default 8
  ---
  ```

- To backfill or recompute: `bun src/health/summarize.ts 2026-10-13 2026-11-03`. On the server: `docker compose exec dashboardify bun src/health/summarize.ts 2026-10-13 2026-11-03`.
- `feel`, `effort_rpe` and `health_tags` come from the morning check-in, not the strap. See [the feedback loop](health-feedback.md).
- The computed tables also go to `health-derived/nights/`, `health-derived/days/`, `health-derived/workouts/`, `health-derived/walks/` and `health-derived/sets/` (Parquet, one file per date, rebuildable; workouts and walks have a row each, and no file on a day without any).

## Lifting log in the daily note

Write what you lifted under `## Workouts`, one bullet per exercise in the order you did them, with an indented line per load. No times needed. The server only reads this section; it never edits it.

```markdown
## Workouts
- Chest Press
    - 60lbs, 1x10
    - 80lbs, 3x10
- Pull-ups
    - 3x12
```

- A load line is `weight unit, sets x reps`. `lb`, `lbs` or `kg`, with or without a space, and `x` or `×`. Several groups can share one weight: `15lbs, 2x10, 1x8` is two sets of 10, then one of 8. Leave the weight out for bodyweight.
- Any other indented line is a note to yourself and is skipped.
- A first line lighter than the exercise's heaviest counts as a warm-up.
- The Health block gets `- Lifting log · 3 exercises · 12 sets · 4,650 lb`, ending `· sets matched 18:02–19:05` once each set is lined up with the strap's heart rate, or `· not matched to the strap` until then. Each set is also a row in `health-derived/sets/`.

## Workout reviews in the daily note

When you say what a workout was on the Activity page, the answer goes into the frontmatter, where
you can also edit it:

```yaml
workout_reviews:
  - start: "18:07"
    end: "18:31"
    kind: none
```

- `start` and `end` are the workout's local times as it was found. A review applies to the workout
  it overlaps by at least half, so a small change in how a workout is found doesn't lose it.
- `kind` is `running`, `walking`, `volleyball`, `lifting` or `workout`, or `none` when it wasn't a
  workout. A dismissed workout is left out of the Health block and the day's workout minutes, but
  kept in `health-derived/workouts/` with `status: dismissed`, so it can be taken back.
- Malformed entries are skipped. Removing the key takes every review back.

## Health: `health/YYYY/YYYY-MM.csv`

One row per day. Columns are `date`, then the metric names sorted, then `source`. Sending the same day again updates that row.

```csv
date,hrv_ms,recovery,steps,source
2026-11-01,,,8412,apple-health
2026-11-02,58.24,70,,strap
```

## Messages: `inbox/messages/YYYY-MM-DD.md`

Marked `privacy: local-only`, so a cloud model never sees them. Each line ends with the message's ID so a resend is ignored.

```markdown
## Received

- 12:05 **Sam**: Moved dinner to 19:00. <!-- id:m1 -->
```
