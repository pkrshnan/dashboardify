# Lifting plan

Log a workout from the control centre with what to do next time already filled in, look up an
exercise to see what you did last, and see the overload: heavier weight, or more reps at the same
weight. One note per exercise holds its history. Design: the Lifting boards on
https://claude.ai/artifact/XoFbk5bcjsHBkEcdTG4uTw. Status: building; LF1–LF6 done, LF7 next.

## Goals

- At the machine, open the exercise and the sets are already filled in from last time plus the
  next step; change only what went differently.
- Show progressive overload both ways: the weight going up, and the reps going up at a weight.
- Use the strap: rest between sets and the peak heart rate of each set, next to the numbers.
- Logging writes the daily note's `## Workouts` the way you type it, so Obsidian stays the record.
- Each exercise is a plain note in Obsidian with its whole history, next to your own cues.

Not goals: programs and routines, rest timers, plate maths, live heart rate while logging.

## Decisions

| Area | Decision |
| --- | --- |
| Source of truth | The daily notes' `## Workouts`. Everything else (exercise notes, charts, suggestions) is rebuilt from them. |
| Writing | The log screen sends one exercise's sets at a time; the server rewrites that exercise's load lines in that day's `## Workouts` and nothing else. Other exercises, notes under it and other sections are kept. A new exercise goes at the end of the section. A missing section goes before `## Journal`, as in your notes, or at the end. A stale etag is `409`, as with tasks. |
| Line format | Weight first, as you type it: `80lbs, 3x10`. Consecutive sets with the same weight share a line (`80lbs, 2x11, 1x10`). The section's bullet (`-` or `*`) and indent are copied; a new section uses `-` and four spaces. |
| Done | A set on screen is done unless removed; there is no tick. Removing is × on desktop and swipe left on the phone, with Undo. An exercise is removed with × (desktop) or a long-press menu (phone). |
| Warm-up | Only when tagged: tap a set's number to make it W. Written as `7.5lbs, 1x10, warm-up`, which you can also type. The old rule (a lighter first line is a warm-up) goes. Warm-ups are left out of volume, records and the suggestion's working sets. |
| Identity | Names match ignoring case, spacing, punctuation and a plural last word. An exercise note's `aliases:` adds spellings ("Dumbell"). The file name is the title. |
| Session | One exercise on one day; logged twice in a day, the lines are joined. |
| Top weight | The heaviest working weight in a session. Reps, est. 1RM and progress are about the sets at it, so ramps never need labelling. |
| Est. 1RM | weight × (1 + mean reps at the top weight / 30), Epley on the average set, so 3x10 beats 10, 9, 8. |
| Progress | Against the exercise's previous session: ↑ weight if the top weight rose, else ↑ reps if the reps at it rose, else = or ↓. |
| Records | Heaviest top weight, best est. 1RM, and the best session at the current top weight. |
| Heart rate | From the sets matched to HR climbs (`sets` in the derived store). Rest: the median gap from one set's peak to the next set's start. Peak: the mean peak HR of the working sets. Absent when the day's sets weren't matched. |
| Next time | Rep range from the exercise note (`reps: 8-12` and `step: 5` by default, 2.5 for kg). Every working set at the top of the range: add the step, reps back to the bottom. Otherwise one more rep each set, up to the top. Three sessions at a weight with no rise in reps: down a step at the bottom of the range. More than 21 days since: repeat last time. Bodyweight: one more rep each set. A warm-up is suggested only if you did one last time. |
| Units | Shown as written; an exercise logged in both is shown in its latest unit (2.20462 lb/kg). Dumbbells are per hand. |
| Exercise notes | `Lifting/<Title>.md`, made the first time an exercise is logged. The server owns a `cc:lifting` block and the `reps`/`step` keys when you change them on the page; the rest is yours. It never deletes a note. Rebuilt at start and when a daily note's `## Workouts` changes (checked every 5 minutes, and at once after a write). |
| Lookup | Exercises grouped by the day you last did them, newest first, each with its top sets. Search filters by name and alias. |
| Phone tab bar | The boards show Today, Lists, +, Habits, More, with + offering Start workout, Add task and Add event. That belongs to the navigation work (Tasks moving into Lists) and isn't built here; Start workout is reached from the Lifting page until then. |

## Vault format

In a daily note, as logged from the page:

```markdown
## Workouts
- Chest Press
    - 60lbs, 1x10, warm-up
    - 80lbs, 2x11, 1x10
```

An exercise note:

```markdown
---
aliases: [Chest press machine]
reps: 8-12
---
Seat on 4.

<!-- cc:lifting -->
## History
Next: 80 lb, 3x11
Records: 80 lb top · est. 1RM 107 · 80 lb, 3x10 on 8 Nov

| Day | Sets | Est. 1RM | Rest | Peak HR | |
| --- | --- | --- | --- | --- | --- |
| [[2026-11-08]] | 60 lb, 1x10 W · 80 lb, 3x10 | 107 | 2:05 | 141 | ↑ reps |
<!-- /cc:lifting -->
```

## API

`proto/dashboardify/v1/lifting.proto`, `LiftingService`:

| Method | Path | Does |
| --- | --- | --- |
| GET | `/v1/exercises` | Each exercise with its last session and next time, newest first |
| GET | `/v1/exercises/{exercise}` | Sessions (sets, top weight, reps at top, est. 1RM, rest, peak HR, progress, records reached), records, next time, rep range, note path |
| PATCH | `/v1/exercises/{exercise}` | `repRange` (written to the note as `reps` and `step`) |
| GET | `/v1/days/{date}/lifting` | That day's log: exercises with their sets, and `etag` |
| PATCH | `/v1/days/{date}/lifting/exercises/{exercise}` | Replace that exercise's sets, adding it when missing; `etag`. Idempotent, so a retry is safe |
| DELETE | `/v1/days/{date}/lifting/exercises/{exercise}` | Remove the exercise and its lines |

`{exercise}` is a slug of the title (`Chest Press` → `chest-press`).

## Web

A `lifting` module at `#/lifting/:exercise?` and `#/lifting/log` (today), sidebar beside Activity,
in More on the phone.

- **Lookup**: "Log a workout", a search box, and exercises grouped by their last day.
- **Exercise**: Next time with the rep range as a link, last session with rest and peak HR, the
  weight chart (top weight as steps, est. 1RM as a dashed line, 3M / 1Y / All), reps at top weight
  as bars grouped by weight, records, history. "HR on Activity ›" opens that workout.
- **Log**: today's exercises (× to remove), "Add an exercise" with "Usually next" (what followed the
  last one in past sessions), and the current exercise's set rows: number (tap for W), weight and
  reps steppers, × or swipe. Each change is saved at once; Undo restores the previous sets.
- **Phone**: lookup is the page; the exercise and the log push on top. The log has a sideways
  exercise bar that stays on the current one.

## Build plan

| # | PR | Scope | Tests |
| --- | --- | --- | --- |
| LF1 | History | `src/lifting/`: name keys, sessions from daily notes, top weight, reps at top, est. 1RM, progress, records, units; `warm-up` marker in the parser, old warm-up rule removed | Real log shapes; plural and case matching; ramps; bodyweight; mixed units; twice in a day; tagged warm-ups |
| LF2 | Heart rate and next time | Rest and peak HR from derived `sets`; the next-time rules | Each rule; no HR; unmatched day |
| LF3 | Writing the log | Render an exercise's sets as lines; replace and remove an exercise in a day's `## Workouts`; vault-format.md | Round trip keeps other lines; bullet and indent copied; new section; grouping; warm-up suffix |
| LF4 | Exercise notes | `Lifting/<Title>.md` with `cc:lifting`, aliases, `reps`/`step`, the rebuild | Created once; user text kept; alias merges; unchanged history not rewritten |
| LF5 | LiftingService | `lifting.proto`, `src/server/api/lifting.ts`, REST bindings, api.md | Each method; stale etag `409`; unknown `404`; a new exercise needs a title |
| LF6 | Lifting page | Lookup and exercise page with charts; demo data; Activity links | Grouping, filter, charts' grouping by weight |
| LF7 | Logging | Log screen on desktop and phone: steppers, W, remove and Undo, add exercise | Save on change, Undo, swipe, Return |

## Open questions

- [ ] `Lifting/` at the root, or under `Health/`?
