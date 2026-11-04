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
- Steps 8,412
- Synced 07:58
<!-- /cc:health -->

## Journal
```

- The night is the one that ended that morning. Strain, zones and steps cover the calendar day.
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
- The computed tables also go to `health-derived/nights/` and `health-derived/days/` (Parquet, one file per date, rebuildable).

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
