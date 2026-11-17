# Day trace plan

Heart rate, steps and skin temperature over a day, as charts on the Health page, with sleep,
workouts and walks shaded behind them so you can see why a line moves. Today by default.
Design: https://claude.ai/artifact/PshadTmZFoNAm9Uaxjg31Q (DT3 waits for its approval). Status: DT1–DT2
built.

## Goals

- See today's heart rate minute by minute, with its zones, next to steps and skin temperature
  on the same time axis.
- Read the data as it came: no scores and no baselines. The trends on the page do that.

Not goals: the strap's other streams. Of the twelve ingested, accel, PPG, `temperature_aux`,
`motion` and `sleep_state` are inputs to metrics, battery and `events` aren't health data, and
HRV is mostly gaps while you're awake. Also not: editing samples, live streaming, more than one
day at a time.

## Decisions

| Area | Decision |
| --- | --- |
| Day | Local midnight to midnight in `vault.timeZone`, cut at now for today. The section follows the page's `?night=`, so stepping a night steps the day too. |
| Where | A Day section on the Health page after Sleep, before Heart, so the page reads in order: recovery, the night, the day since. Sleep's night stepper sits above both. Titled "Today", or the date ("Sun 15 Nov"). The range switch doesn't touch it. |
| Work | On the server: one call reads the day's three streams (well under 300 ms) and buckets them, so the page gets about 1,440 points a chart, not 86,400 rows. Nothing is stored. |
| Gaps | A bucket with no samples is missing, not zero, and the line breaks there. Heart rate of 0 is no sample. Time the strap says it was off (`wear.on` = 0) is shaded as not worn. |
| Counting | The same helpers as the metrics: a heart-rate minute needs 30 samples (`minuteHr`), and steps come from `stepsPerMinute`, which handles the counter's wraps and resets. |
| Zones | By % of max HR, as `zoneMinutes` counts them (50, 60, 70, 80, 90). Max HR is the profile's measured one, else from age; without either, no zones. |
| Shading | The night that ended that morning and one that starts that evening (bed to wake), and the day's workouts and walks, from `health-derived/`. Dismissed workouts are left out. |

## Series

| Series | From | Bucket | Shown as |
| --- | --- | --- | --- |
| Heart rate | `heart_rate.bpm` | 1 min mean, with min and max | Line over a min–max band, coloured by zone |
| Steps | `steps.count` | 5 min sum | Bars; the day's total in the title |
| Skin temperature | `temperature.celsius` | 1 min mean | Line, °C |

## API

`GET /v1/days/{date}/trace` (`ActivityService.GetDayTrace`): the day's start and end; each
series as its kind, bucket length and dense `values` from the start, with `missingIndexes` (as
uploads mark missing rows), and for heart rate `low` and `high`; max HR when known; and spans
(sleep, workout with its kind, walk, not worn) with a start and end. An empty day is an empty
trace, not `404`. Fields: `proto/dashboardify/v1/activity.proto`.

## Web

Each signal is its own card, full width and stacked: heart rate, then steps, then skin
temperature. A card has its title, a large value (the latest, or the day's total for steps),
its own 00:00–24:00 axis and the shading, with y labels inside the plot so a phone keeps the
full width. Heart rate's grid is the zone lines, labelled with bpm on the left and Z1–Z5 on
the right. Hovering or dragging picks one minute for all three, and each card's value shows
that minute; on desktop, leaving the charts goes back to the latest.

## Build plan

| # | PR | Does | Tests |
| --- | --- | --- | --- |
| DT1 | Plan | This doc, CLAUDE.md, roadmap | — |
| DT2 | GetDayTrace | `src/health/trace.ts` (buckets and spans), the RPC in `activity.proto` and `src/server/api/activity.ts`, binding, api.md | Each series; gaps; HR 0; counter wrap; zones without a profile; spans; local day across two UTC files; today cut at now; empty day |
| DT3 | Day section | The charts and shading on the Health page, demo streams for today | Scales, gaps break the line, step total, zone colours; follows `?night=` |
| DT4 | Reading a minute | The shared minute and each card value at it | Nearest bucket per series; missing shows "–"; back to latest on leave |
