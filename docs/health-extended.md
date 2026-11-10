# Health: the rest

Plan for the health numbers still missing: training load, calories, VO2max and sleep stages.
Status: H1–H5, H8–H10, H12 and H13 done, H6 and H7 (fitness and biological age) dropped, H14
and H11 planned; H11 waits for artboards. As each PR lands, its section moves into [health-metrics.md](health-metrics.md). This
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
| H8 | Epoch features | Done; now in [health-metrics.md](health-metrics.md#sleep-stages-sleep-stagests) |
| H9 | Sleep stages | Done; now in [health-metrics.md](health-metrics.md#sleep-stages-sleep-stagests) |
| H10 | API | Done: `EXTENDED_METRICS` in `health-history.ts` (off the home list until H11); `GetNight` in [api.md](api.md#activity) |
| H12 | Trained stages | Done; now in [health-metrics.md](health-metrics.md#sleep-stages-sleep-stagests) |
| H13 | DFA α1 | Done; now in [health-metrics.md](health-metrics.md#sleep-stages-sleep-stagests) |
| H14 | Per-person refit | HRV, breathing and DFA emissions fitted to your own nights |
| H11 | UI | home rows, workout calories, a night view with the hypnogram (after artboards) |

Each PR adds tests on made-up samples, its section in `health-metrics.md`, and its keys in
`vault-format.md`; H4 and H10 update `api.md`.

## Stages, round two

H9's hand-set model called 65% of real nights light and flagged half of them.

- **H12:** HR, movement and transitions fitted to Walch 2019's lab nights, with leave-one-out
  accuracy against H9, and a flag only for nights the model rarely gives.
- **H13 (done):** DFA α1 over the RR around each epoch: short-term correlations are lost in deep
  sleep and high in REM and wake (Penzel 2003; Bunde 2000).
- **H14:** an offline command like `tune.ts` that re-fits the HRV, breathing and DFA emissions
  to your own nights by EM, holding the trained HR, movement and time parts fixed; versioned
  params.

## Open questions

- [ ] Is a fixed `weight_kg` in the profile enough, or log weight over time?
