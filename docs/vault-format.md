# Vault format

What the server writes, so files can be edited by hand without breaking anything.

## Rules

- The server touches only frontmatter keys it was sent, lines it appends under `## Journal` and
  `## Received`, and regions between `<!-- cc:name -->` and `<!-- /cc:name -->`.
- Writes are atomic (temp file, then rename), one at a time per file, and skipped when nothing
  changes, so sync and backups only see real edits.
- Days follow the server's time zone, so 23:30 lands on that day even across DST.
- A task is a `- [ ]` line with its details as sub-bullets ([fields.md](fields.md)):

  ```markdown
  - [ ] Call the bank <!-- id:k7f3a2 -->
  	- due: 2026-11-03 09:00
  	- repeat: every week
  	- priority: high
  ```

  The server rewrites only the line and its `due`, `repeat`, `priority` and `done` fields; other
  bullets under it are yours. Older Obsidian Tasks emoji lines are still read and are rewritten
  in this form on their next edit. New tasks go to the inbox note (Settings › General, default
  `Inbox.md`). Every `- [ ]` line in the vault is read as a task, except in `Lists/`.
- Folders and notes the server owns are capitalised: `Daily/`, `Health/`, `Profile.md`. On start
  it renames the older `daily/`, `health/` and `profile.md`, unless the new name already exists.

## Daily note: `Daily/YYYY/YYYY-MM-DD.md`

```markdown
---
recovery_pct: 62
strain: 11.4
load_acute: 74.2
load_chronic: 68.9
load_ratio: 1.08
kcal: 2640
active_kcal: 610
vo2max: 57
sleep_score: 84
tst_min: 432
deep_min: 85
rem_min: 100
light_min: 247
rhr_bpm: 52
rmssd_ms: 48
steps: 8412
feel: 4
workout_reviews:
  - start: "18:07"
    end: "18:31"
    kind: none
---
# 2026-11-02

<!-- cc:health -->
## Health
- Recovery **62%**
- Sleep **84** · 7h 12m of 8h 00m · 23:41–07:05
- Deep 1h 25m · REM 1h 40m · Light 4h 07m
- RHR 52 · HRV 48 ms · Breathing 14.2 · Skin +0.2 °C
- Strain **11.4** · Zones 42 / 18 / 6 / 0 / 0 min
- Load steady · 1.08 (7 d vs 28 d)
- Calories 2,640 · 610 active
- VO2max 57 (estimate)
- Volleyball 20:30–21:15 · 45 min · 138 avg / 179 max · strain 8.3 · 410 kcal
- Lifting log · 3 exercises · 12 sets · 4,650 lb · sets matched 18:02–19:05
- Synced 07:58
<!-- /cc:health -->

<!-- cc:agenda -->
## Agenda
- All day: Sam's birthday
- 10:00–10:15 Standup
<!-- /cc:agenda -->

## Journal
- 07:55 Gym felt heavy.
- 22:10 Long day.
  Second line of the same entry.

## Workouts
- Chest Press
    - 60lbs, 1x10
    - 80lbs, 3x10
- Pull-ups
    - 3x12
```

- **Health** is recomputed a couple of minutes after each strap upload and hourly for today
  ([health-metrics.md](health-metrics.md)). The night is the one that ended that morning; strain,
  workouts and steps cover the calendar day. Load (`load_*`) is the last 7 days' TRIMP against
  the last 28's and needs four weeks of days. Calories (`kcal`, `active_kcal`) need weight, height,
  birth date and sex in `Profile.md`, and are a running total today; a workout line ends with its
  own. VO2max (`vo2max`, whole ml/kg/min) needs `hr_max_measured`, `sex` and 14 of the last 30
  nights. Stages (`deep_min`, `rem_min`, `light_min`) are estimated from HR, HRV and breathing;
  the line ends `· unusual` when a share is outside what held-out lab nights show. An unsure
  workout ends with `?` (`Lifting?`) until reviewed. A Strava run adds distance and pace:
  `- Running 10:42–11:14 · 32 min · 5.1 km · 6:16 /km · …`. "Synced" is on today only and turns
  into `**14h behind**` past two hours.
- **Agenda** is today's events, rewritten after each calendar sync that changes them.
- **Journal** entries are `- HH:MM text`, continuation lines indented two spaces.
- **Workouts** is yours; the server only reads it. A load line is `weight unit, sets x reps`,
  or the weight last (`lb`, `lbs` or `kg`; `x` or `×`; several groups share one weight; no weight
  for bodyweight). Other indented lines are notes. A first line lighter than the heaviest is a warm-up.
- **`workout_reviews`** come from the Activity page and can be edited. A review applies to the
  workout it overlaps by at least half. `kind` is `running`, `walking`, `volleyball`, `lifting`,
  `workout` or `none`. Malformed entries are skipped.
- **`feel`, `effort_rpe`, `health_tags`** come from the morning check-in
  ([health-feedback.md](health-feedback.md)).
- **`habits`** lists the ids of the habits ticked that day: `habits: [meditate, read]`
  ([habits.md](habits.md)). The server adds and removes ids and drops the key when none are left.

## Lists: `Lists/<Title>.md`

One note per list ([lists.md](lists.md)); the file name is the list's title. `##` headings are
sections and `- [ ]` / `- [x]` lines are items; a trailing `(…)` is the item's note. The server
adds items at the end of the block before the first heading, or of the section they're added to
(a new section's `## Heading` goes at the end of the note). It unticks an item that's added
again, moves an item's line (with its indented lines) to the end of another section, and removes
`[x]` lines when you clear what's done. Every other line
is left alone, and no ids are written into the note.

```markdown
- [ ] Coffee beans

## Produce
- [ ] Spinach (2 bags)
- [x] Lemons
```

## `Habits.md`

At the vault root ([habits.md](habits.md)). Each top-level `- ` line that isn't a checkbox is a
habit: its name, then `·`-separated fields (a schedule, `auto <rule>`, a colour, `since
YYYY-MM-DD`, `paused` or `archived`), then its id. The server appends new habits after the last one and rewrites a habit's
line when it's edited, writing its id so a rename keeps its history; a line without an id is
named by its slug. Fields it doesn't know and every other line are left alone.

```markdown
- Meditate · daily <!-- id:meditate -->
- Lift · 3 a week · auto lifting · #40C8E0 <!-- id:lift -->
- Read · Mon Wed Fri · paused <!-- id:read -->
```

## `Profile.md`

At the vault root. Strain needs `birth_date` (or `hr_max_measured`); `sex` picks the strain
constants; `sleep_need_h` defaults to 8. Calories need `weight_kg` and `height_cm`; VO2max needs
`hr_max_measured`.

```yaml
---
birth_date: 1996-05-01
sex: male
hr_max_measured: 192
sleep_need_h: 8
weight_kg: 72
height_cm: 178
---
```

## `Health/YYYY/YYYY-MM.csv`

One row per day: `date`, the metric names sorted, then `source`. A day sent again replaces its row.

## `inbox/messages/YYYY-MM-DD.md`

`privacy: local-only`. Lines under `## Received`, each ending in its ID so a resend is ignored:

```markdown
- 12:05 **Sam**: Moved dinner to 19:00. <!-- id:m1 -->
```

## Recomputing

`bun src/health/summarize.ts 2026-10-13 2026-11-03` (on the server, prefix
`docker compose exec dashboardify`). Computed tables also go to `health-derived/` (`nights/`,
`days/`, `workouts/`, `walks/`, `sets/`, `stages/` with one row per stage run; Parquet, one file
per date, rebuildable).
