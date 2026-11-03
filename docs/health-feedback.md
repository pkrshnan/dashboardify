# Health feedback loop

Recovery's weights started as a guess. The feedback loop checks them against how you say you feel
each morning, and proposes new ones only when they would have agreed better with you on mornings
they never saw.

## 1. Check in

`POST /api/health/checkin` (see [the API](api.md)) writes to that day's note:

```markdown
---
feel: 4             # 1 drained … 5 great, how you feel this morning
effort_rpe: 7       # 0–10, how hard today's workout felt (optional)
health_tags: [alcohol, travel]
---
```

A Siri Shortcut is the easy way: *Ask for Number* (1–5) → *Get Contents of URL* (POST, JSON body
`{"feel": <number>}`, header `Authorization: Bearer <token>`) → *Speak* the `message` it returns.
`feel` is only ever the thing recovery is checked against. It is never an input to recovery, so the
score can't turn into a mirror of your mood.

## 2. Params

The weights live in `HEALTH_DERIVED_PATH/params/current.json`. Without that file the defaults are
used (`src/health/params.ts`):

```json
{ "version": "1", "recovery": { "hrv": 0.5, "rhr": 0.25, "sleep": 0.15, "breathing": 0.1 } }
```

Each applied change bumps `version` and keeps a copy as `params/v<version>.json`. Every derived
night and day row records the `params_version` that produced it, so old numbers can always be
traced and rebuilt.

## 3. Re-fit (`feedback/refit.ts`)

For each rated morning, recovery's terms (z_HRV, −z_RHR, z_sleep, breathing penalty) are the inputs
and `feel` is the target. Ridge regression pulled toward the current weights:

```
w = (XᵀX + λI)⁻¹ (Xᵀy + λ·s·w_current)        λ = 30 mornings
```

- Recovery only cares about the weights' ratios, so `s` scales the current weights to feel units
  (the best single multiplier of the current score onto feel). If the current score predicts feel
  backwards or not at all, nothing is fitted.
- λ = 30 means the current weights count as much as 30 mornings of evidence: with 30 ratings the
  fit lands about halfway, with 300 it mostly follows the data.
- Guardrails: at least 30 rated mornings, no negative weights, the same total as now, and no
  weight moves more than 0.10 in one re-fit.

## 4. Backtest (`feedback/backtest.ts`)

Before anything changes, past nights are replayed exactly as the daily summary scores them (z-scores
against the 60 calendar days before each night).

- **Walk-forward.** For each of the last 4 weeks: re-fit on every night before that week, then score
  that week with both the current and the re-fitted weights. Agreement is the rank correlation
  (Spearman) between recovery and feel on those held-out mornings.
- **Shift.** How far each past day's recovery would move under the new weights.

A re-fit is proposed only if held-out agreement rises by at least 0.05 and no single day moves more
than 25 points.

## 5. Tune

```sh
bun src/health/tune.ts                       # last 180 days to yesterday, report only
bun src/health/tune.ts 2026-05-01 2026-11-02 # a chosen range
bun src/health/tune.ts --apply               # save the new version if it passed
```

On the server, prefix with `docker compose exec dashboardify`. The report shows the weights side by
side, held-out agreement before and after, and the biggest day shift. After `--apply`, rebuild past
days with `bun src/health/summarize.ts FROM TO` so their recovery uses the new weights.

## Next

Expected recovery from yesterday's strain and sleep debt, a "why?" question when a morning surprises
it, a weekly note with an approve checkbox in place of `--apply`, and tuning strain response and
sleep need the same way.
