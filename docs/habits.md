# Habits plan

Things you mean to do regularly (meditate, read, floss, lift three times a week, 8,000 steps) and
a record of whether you did. Design: https://claude.ai/artifact/PQe6S6nfjyGt242ui4udNK.
Status: plan, nothing built (HB1–HB6).

## Goals

- Tick a habit in one tap from Today or the phone, or by Siri ("I meditated").
- Habits the server already has data for tick themselves: steps, workouts, bedtime, journal,
  check-in.
- See how a habit is going over weeks, not just whether one streak survived.
- The record is plain notes you can read and edit in Obsidian.

Not goals: reminders or notifications (that's Tasks), counts and quantities ("8 glasses"),
badges or scores, habits to quit with a relapse counter (a daily "No alcohol" covers it).

## Habits are not tasks

A recurring task (`🔁 every day`) is something to get done: missing it leaves it overdue and
it nags. A habit is a record per day: missing one is just a gap, and the history is the point.
So habits never write `- [ ]` lines, never appear in Tasks, and Tasks aren't converted.

## Decisions

| Area | Decision |
| --- | --- |
| Definitions | One note, `Habits.md` at the vault root. Each habit is a plain `- ` line (never a checkbox): name, then `·`-separated fields, then `<!-- id:… -->`. Other lines are left alone. |
| Ids | Written by the server when the page creates a habit, so renaming it in Obsidian keeps its history. A hand-typed line without one is named by its slug. |
| Colour | `· #40C8E0`, one of seven from the design palette; without one, the next unused |
| Schedules | `daily`, `N a week` (Monday–Sunday weeks), or weekdays (`Mon Wed Fri`). No "every N days". |
| Done | The daily note's `habits:` frontmatter, a list of ids: `habits: [meditate, floss]`. A plain list shows as chips in Obsidian's Properties. The server owns only this key. |
| Auto habits | `auto <source>` on the line. Computed on read from what's already in the note or the derived tables, never written to `habits:`, so a health sync doesn't rewrite every note. Ticking one by hand (strap off) writes it to `habits:` like any other. |
| Auto sources | `steps ≥ N` (`steps`), a workout kind (`lifting`, `running`, `volleyball`, `workout`, after reviews), `asleep before HH:MM` (the night that ended that morning), `journal` (an entry under `## Journal`), `checkin` (`feel` set) |
| Day | The server's time zone. Until 04:00, Today and Siri tick the day before, so "read" at 00:40 counts for the evening it was. The Habits page's grid can fix any past day. |
| Streaks | Daily and weekday habits: consecutive scheduled days done; today unticked doesn't break it, and one missed day is forgiven but two in a row end it ("never miss twice"). `N a week`: consecutive weeks met; the current week counts once met. |
| Rate | Done ÷ scheduled over the last 30 days, shown beside the streak, so one miss doesn't erase a month. |
| Pause | `· paused` on the line: off the page and Today, skipped days don't break the streak. `· archived` hides it but keeps history. Deleting is done in Obsidian. |
| History | Read from the daily notes of the last 400 days, cached per note by mtime. |
| Concurrency | Marks go through `Vault.update` on the daily note, one writer per file. Marking is idempotent (`done: true` twice is one id), so no etag. `Habits.md` edits carry its etag; a stale one is `409`. |

## Vault format

```markdown
# Habits

- Meditate · daily <!-- id:meditate -->
- Lift · 3 a week · auto lifting · #40C8E0 <!-- id:lift -->
- Steps · daily · auto steps ≥ 8000 <!-- id:steps -->
- Bed by 23:30 · Sun Mon Tue Wed Thu · auto asleep before 23:30 <!-- id:bed -->
- Read · daily · paused <!-- id:read -->
```

```yaml
# daily/2026/2026-11-12.md
habits: [meditate, read]
```

## API

`proto/dashboardify/v1/habit.proto`, `HabitService`:

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/habits` | Each habit with its schedule, `auto`, colour, state, and as of `day` (default today): `done`, `due`, `streak`, the 30-day count, this week's count |
| POST | `/v1/habits` | Append a line to `Habits.md` with a new id; `requestId` makes a retry safe |
| PATCH | `/v1/habits/{habit}` | `name`, `schedule`, `auto`, `state` (send `updateMask`) |
| GET | `/v1/habits/{habit}/days` | `from`, `to`: each day's `done`, `scheduled` and whether it was `auto` |
| POST | `/v1/habits/{habit}:mark` | `day`, `done`: add or remove the id in that day's `habits:` |
| RPC | `VoiceService/MarkHabit` | `text`: finds the habit by its spoken name, marks it, speaks back the streak ("Meditate: 12 days") |

`Home` gains today's due habits, so Today needs no second call.

## Web

A `habits` module at `#/habits` (`?habit=` opens one), sidebar group 2, More on the phone, keys
`g b`. UI waits for approved artboards on the design canvas.

- Habits page: a row per habit with its name, cadence and source, the streak with the 30-day
  count (orange "Missed yesterday" when today decides it), a GitHub-style grid of the last 26
  weeks (Monday to Sunday, top to bottom), and a 40 px tick for today. Cells: the habit's colour
  when done, grey when missed, outlined when not scheduled, a ring on today. A `N a week` habit
  gets a bar under each week that fills when the week is met. Tapping a cell fixes that day.
- Beside the list, the selected habit's settings: name, "How often" (Every day, Times a week
  with − and +, Set days with seven day buttons), "Ticks itself from", colour, Pause, Archive.
  "+ New habit" opens the same form empty.
- Phone: the list with 20 weeks per grid (read-only) and a 44 px tick; "+" opens a New habit
  sheet with the same fields and a preview grid in the chosen cadence. Fixing a past day is in
  the habit's own view.
- Today: a row of today's due habits as chips; tap ticks. Auto ones tick themselves.
- Command bar: "Mark habit" takes a habit; "did meditate" works as text.

## Build plan

| # | PR | Scope | Tests |
| --- | --- | --- | --- |
| HB1 | Habit notes | `src/habits/`: parse and write `Habits.md`, schedules, `habits:` in daily notes, the 04:00 rule; vault-format.md | Round trip keeps other lines; slug without an id; rename keeps id; mark is idempotent; 00:40 ticks yesterday |
| HB2 | Streaks and auto habits | Streak, rate, weekly counts; the auto sources over notes and derived tables; the mtime cache | Never-miss-twice; weekday and `N a week` edges; paused days; DST week; each source |
| HB3 | HabitService | `habit.proto`, `src/server/api/habits.ts`, REST bindings, Home's habits, api.md | Each method; stale `Habits.md` etag `409`; unknown habit `404`; `requestId` retry |
| HB4 | Siri | `VoiceService.MarkHabit`, `shortcuts/mark-habit.md` | Fuzzy name, unknown habit, spoken streak |
| HB5 | Habits page | `web/modules/habits.tsx`, `web/api.ts`, styles, demo habits | Grid cells per cadence, week bars, fix a past day, cadence form; the module in the nav; Return in the new-habit form in real Firefox |
| HB6 | Today row | Today's chips, the command bar's "Mark habit" | Tick, auto chip, done state |

## Open questions

- [ ] Counted habits ("8 glasses") as `habits:` map entries, or keep them out?
- [ ] Is 04:00 right for the day's end, or should it follow last night's sleep onset?
- [ ] Should Today's focus sentence mention a streak at risk ("Read: miss today and it ends")?
