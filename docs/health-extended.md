# Health: the rest

Plan for the health numbers still missing: training load, calories, VO2max and sleep stages.
Status: H1–H5 done, H6 and H7 (fitness and biological age) dropped, H8–H11 planned; H11 waits for
artboards. As each PR lands, its section moves into [health-metrics.md](health-metrics.md). This
file goes when the last one does.

## Goals

- Each number comes from data the strap already sends, plus a few profile fields.
- Each is honest about how good it is: estimates say so, and nothing feeds recovery until it has
  been checked against something.
- Same pattern as today: one pure file per idea in `src/health/metrics/`, constants cited in
  comments, a row in `health-derived/`, keys in the daily note, a line in the Health block.

Not goals: SpO2 from the raw `ppg` stream, runs with pace and route (roadmap #6), a strain target
(roadmap #8). Each is its own plan.

## Decisions

| Area | Decision |
| --- | --- |
| Order | Training load first (needs nothing new), then calories, VO2max, and stages last (hardest, least checkable) |
| Profile | `weight_kg` and `height_cm` join `profile.md`. Without them, calories are left out, as strain is without a birth date. |
| Population norms | The "your own history, never population averages" rule holds, with one exception: VO2max is a comparison with people by definition. Its doc says so. |
| Recovery | No new number feeds recovery or the sleep score in this plan |
| Versions | Each PR that changes rows bumps `ALGO_VERSION`; rebuild with `summarize.ts` |
| UI | Note and API first. Home rows, Activity calories and a sleep view wait for artboards (H11). |

## Sleep stages (`sleep-stages.ts`)

Light, deep and REM for each asleep epoch; awake stays as `sleep-epochs.ts` scores it.

- **Features per epoch**, each a z-score against the night: HR, RMSSD over the surrounding 5 min,
  breathing regularity (how sharp the breathing peak is in a 2-min spectrum, as `breathing.ts`
  does for the night), and movement.
- **What they mean:** deep is low HR, high HRV and very regular breathing; REM is HR up and
  irregular, low HRV, no movement; light is in between (Fonseca 2017, Walch 2019).
- **A 4-state hidden Markov model** (awake fixed, light, deep, REM), decoded with Viterbi.
  Transitions from adult sleep-lab norms: deep mostly in the first third, the first REM rarely
  under an hour after onset, REM bouts growing through the night. This gives the 90-minute cycles
  without hard-coding them.
- Wrist and arm staging agrees with a sleep lab about 60–65% of the time for 4 stages. Shown as
  "estimated"; a night far outside 40–65% light, 10–25% deep, 15–30% REM is flagged.
- There is nothing to check against yet, so it is checked for plausibility only and tuned as
  nights with the strap pile up.
- Writes `stages/` (one row per run: start, end, stage) and `light_min`, `deep_min`, `rem_min` in
  `nights/` and the note.

## Note

```markdown
- Sleep **84** · 7h 12m of 8h 00m · 23:41–07:05
- Deep 1h 25m · REM 1h 40m · Light 4h 07m
- Calories 2,640 · 610 active
- Load steady · 1.08 (7 d vs 28 d)
- VO2max 48
```

## PRs

| # | PR | Holds |
| --- | --- | --- |
| H1 | Training load | Done; now in [health-metrics.md](health-metrics.md#training-load-loadts) |
| H2 | Body fields | Done; now in [vault-format.md](vault-format.md#profilemd) |
| H3 | Calories | Done; now in [health-metrics.md](health-metrics.md#calories-caloriests) |
| H4 | Workout calories | Done; now in [health-metrics.md](health-metrics.md#calories-caloriests) |
| H5 | VO2max | Done; now in [health-metrics.md](health-metrics.md#vo2max-vo2maxts) |
| H6 | Fitness age | Dropped: no reference data spans adult ages for South Asians |
| H7 | Biological age | Dropped, for the same reason |
| H8 | Epoch features | per-epoch HR, RMSSD, breathing regularity, movement; pure, tested |
| H9 | Sleep stages | HMM and Viterbi; `stages/`, `nights/` columns, note line |
| H10 | API | home trend rows for the new keys; `GetNight` returns the stage runs |
| H11 | UI | home rows, workout calories, a night view with the hypnogram (after artboards) |

Each PR adds tests on made-up samples, its section in `health-metrics.md`, and its keys in
`vault-format.md`; H4 and H10 update `api.md`.

## Open questions

- [ ] Is a fixed `weight_kg` in the profile enough, or log weight over time?
