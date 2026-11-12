# Habits plan

Things you mean to do regularly (meditate, read, floss, lift three times a week, 8,000 steps) and
a record of whether you did. Design: https://claude.ai/artifact/PQe6S6nfjyGt242ui4udNK.
Status: HB1–HB6 built (Habits.md, ticks, streaks, day facts, HabitService, Siri: [shortcuts/did-habit.md](../shortcuts/did-habit.md), the Habits page). Next, HB7.

## Goals

- Tick a habit in one tap from Today or the phone, or by Siri ("I meditated").
- Habits the server already has data for tick themselves: steps, workouts, lights out, journal,
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
| Start | `· since YYYY-MM-DD`, written when the page creates a habit, so earlier days aren't misses. A tick before it moves the start back; without one, its first tick. |
| Schedules | `daily`, `N a week` (Monday–Sunday weeks), or weekdays (`Mon Wed Fri`). No "every N days". |
| Done | The daily note's `habits:` frontmatter, a list of ids: `habits: [meditate, floss]`. A plain list shows as chips in Obsidian's Properties. The server owns only this key. |
| Auto habits | `auto <fact> <op> <value>` on the line: one comparison against one of the day's facts ([below](#auto-ticks)). No code per habit. Computed on read, never written to `habits:`, so a health sync doesn't rewrite every note. Ticking one by hand (strap off) writes it to `habits:` like any other. |
| Day | The server's time zone. Until 04:00, Today and Siri tick the day before, so "read" at 00:40 counts for the evening it was. The Habits page's grid can fix any past day. |
| Streaks | Daily and weekday habits: consecutive scheduled days done; today unticked doesn't break it, and one missed day is forgiven but two in a row end it ("never miss twice"). `N a week`: consecutive weeks met; the current week counts once met. |
| Rate | Days done of those scheduled in the last 30 (weeks met of the last 4 for `N a week`), shown beside the streak, so one miss doesn't erase a month. |
| Pause | `· paused` on the line: off Today, greyed on the page with no streak. Nothing records when a pause began, so days while paused count as misses once it resumes. `· archived` hides it but keeps history. Deleting is done in Obsidian. |
| History | Read from the daily notes of the last 400 days, cached per note by mtime. A streak stops there. |
| Concurrency | Marks go through `Vault.update` on the daily note, one writer per file. Marking is idempotent (`done: true` twice is one id), so no etag. `Habits.md` edits carry its etag; a stale one is `409`. |

## Vault format

```markdown
# Habits

- Meditate · daily · since 2026-06-01 <!-- id:meditate -->
- Lift · 3 a week · auto lifting · #40C8E0 <!-- id:lift -->
- Steps · daily · auto steps ≥ 8000 <!-- id:steps -->
- Lights out · Sun Mon Tue Wed Thu · auto lights_out ≤ 23:30 <!-- id:lights-out -->
- Read · daily · paused <!-- id:read -->
```

```yaml
# daily/2026/2026-11-12.md
habits: [meditate, read]
```

## Auto ticks

`FactReader` in `src/habits/facts.ts` reads a day's note, the next morning's, and the derived
`days`, `nights` and `workouts` rows once, keeps the facts until one of those files changes, and
returns named values. A habit's rule compares one of them: `≥` or `≤` (`>=`, `<=` also
read), against a number, minutes or a time. A bare fact (`auto lifting`) uses its default. A
registry lists each fact's label, kind, day and default; the page's "Ticks itself from" menu and
`ListHabitFacts` come from it. A new source is one fact, not a new resolver.

| Fact | Kind | From | Default |
| --- | --- | --- | --- |
| `steps` | count | `steps` | `≥ 8000` |
| `active_kcal` | kcal | `active_kcal` | `≥ 500` |
| `strain` | number | `strain` | `≥ 12` |
| `zone2_min` | minutes | `days/`, zone 2 and up | `≥ 30` |
| `lifting`, `running`, `volleyball`, `walking`, `workouts` | count | workouts after reviews (an unsure one waits for its review); `workouts` is any kind | `≥ 1` |
| `lights_out` | time, night | the night's `bed_ts`, the start of the sleep window: lying down and still, not sleep onset, so a slow night doesn't break it | `≤ 23:30` |
| `asleep_min` | minutes, night | `tst_min` | `≥ 420` |
| `journal` | count | entries under `## Journal` | `≥ 1` |
| `feel` | 1–5 | the morning check-in | `≥ 1` (checked in at all) |

- **Night facts** count for the evening the night started, so Wednesday's square is Wednesday
  night, read from Thursday's note.
- **Times** compare on a clock that starts at noon, so 00:20 is later than 23:30.
- **Missing isn't missed.** A fact not in yet (tonight's lights out, today's steps before the
  day ends) leaves the day pending: no tick, no miss, the streak waits. Today's cumulative facts
  can tick early (8,000 steps by 15:00) but never untick.
- **A changed rule rewrites the past.** Auto ticks are computed, so raising `steps` to 10,000
  changes old squares; days ticked by hand stay ticked.
- **Out of scope:** compound rules ("lifting and 45 minutes"). Add a fact (`lifting_min`)
  instead of a rule language.

## API

`proto/dashboardify/v1/habit.proto`, `HabitService`; paths in [api.md](api.md#habits).
`ListHabits` and `GetHabit` give each habit's progress as of a day, `ListHabitDays` how each day
went for the grid, `MarkHabit` ticks a day by hand, and `ListHabitFacts` lists the facts. Create
is safe to retry: a habit with the same name is returned. `VoiceService/TickHabit` takes `text`
("I meditated"), finds the habit whose every word was said, whatever the ending, ticks it (the
day before for "yesterday" or "last night"), and speaks the streak ("Ticked Meditate. 12 days.").
`Home` gains today's due habits, so Today needs no second call.

## Web

A `habits` module at `#/habits/<habit>` (`new` for a new one), sidebar group 2, More on the phone,
keys `g b`. Look: [design/README.md](design/README.md#habits-page).

- Habits page: a row per habit with its name, cadence and source, the streak with the 30-day
  count (orange "Missed yesterday" when today decides it), a 20 px tick for today beside the
  name, and a GitHub-style grid of the last 36 weeks (Monday to Sunday, top to bottom) to the
  right edge. Cells: the habit's colour
  when done, grey when missed, outlined when not scheduled, a ring on today. Tapping a cell fixes
  that day. A `N a week` habit shows this week as N dots under its streak, one filled per day done.
- Beside the list, the selected habit's settings: name, "How often" (Every day, Weekly
  with − and +, Set days with seven day buttons), "Ticks itself from", colour, Pause, Archive.
  "+ New habit" opens the same form empty.
- Phone: the list with 23 weeks per grid (read-only) and a 22 px tick beside the name (44 px to
  tap); "+" opens a New habit screen with the same fields. A habit's own screen has this week's
  seven days to tap, to fix one.
- Today: a row of today's due habits as chips; tap ticks. Auto ones tick themselves.
- Command bar: "Mark habit" takes a habit; "did meditate" works as text.

## Build plan

| # | PR | Scope | Tests |
| --- | --- | --- | --- |
| HB1 | Habit notes | `src/habits/`: parse and write `Habits.md`, schedules, `habits:` in daily notes, the 04:00 rule; vault-format.md | Round trip keeps other lines; slug without an id; rename keeps id; mark is idempotent; 00:40 ticks yesterday |
| HB2 | Streaks | Streak, rate, weekly counts, pending days; the mtime cache | Never-miss-twice; weekday and `N a week` edges; paused days; pending doesn't break; DST week |
| HB3 | Day facts | `facts.ts`: `dayFacts`, the registry, parsing and checking `auto` rules; auto ticks in streaks | Each fact from a fixture day; night facts read the next note; 00:20 later than 23:30; missing is pending; bare fact uses its default |
| HB4 | HabitService | `habit.proto`, `src/server/api/habits.ts`, REST bindings, api.md | Each method; facts list; stale `Habits.md` etag `409`; unknown habit `404`; `requestId` retry |
| HB5 | Siri | `VoiceService.TickHabit`, `shortcuts/did-habit.md` | Fuzzy name, unknown habit, spoken streak |
| HB6 | Habits page | `web/modules/habits.tsx`, `web/api.ts`, styles, demo habits | Grid cells per cadence, the week's dots, fix a past day, cadence form; the module in the nav; Return in the new-habit form in real Firefox |
| HB7 | Today row | Home's due habits, Today's chips, the command bar's "Mark habit" | Tick, auto chip, done state |

## Open questions

- [ ] Counted habits ("8 glasses") as `habits:` map entries, or keep them out?
- [ ] Is 04:00 right for the day's end, or should it follow last night's sleep onset?
- [ ] Should Today's focus sentence mention a streak at risk ("Read: miss today and it ends")?
