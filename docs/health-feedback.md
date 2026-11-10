# Health feedback loop

Recovery's weights started as a guess. The loop checks them against how you say you feel each
morning, and proposes new ones only when they would have agreed better on mornings they never saw.

1. **Check in.** `PATCH /v1/days/{day}/checkin` or `VoiceService/CheckIn` writes `feel` (1–5),
   `effort_rpe` (0–10) and `health_tags` to the daily note. Siri Shortcut: *Ask for Number* →
   *Get Contents of URL* (POST `/dashboardify.v1.VoiceService/CheckIn`, body
   `{"feel": "<number>"}`, bearer token) → *Speak* `message`. `feel` is only ever the target,
   never an input, so recovery can't mirror your mood.
2. **Params.** Weights live in `HEALTH_DERIVED_PATH/params/current.json` (defaults in
   `src/health/params.ts`: HRV 0.5, RHR 0.25, sleep 0.15, breathing 0.1). Each applied change
   bumps `version` and keeps `params/v<version>.json`; every derived row records the
   `params_version` that made it.
3. **Re-fit** (`feedback/refit.ts`). Ridge regression of feel on recovery's terms, pulled toward
   the current weights scaled to feel units: `w = (XᵀX + λI)⁻¹ (Xᵀy + λ·s·w_current)`, λ = 30
   mornings. Nothing is fitted if the current score doesn't predict feel. Guardrails: 30+ rated
   mornings, no negative weights, same total, no weight moves over 0.10.
4. **Backtest** (`feedback/backtest.ts`). Walk-forward over the last 4 weeks: re-fit on the nights
   before each week, then compare Spearman correlation of recovery and feel on that week, old
   weights against new. Proposed only if agreement rises by 0.05+ and no day moves over 25 points.
5. **Tune.**

   ```sh
   bun src/health/tune.ts                        # last 180 days, report only
   bun src/health/tune.ts 2026-05-01 2026-11-02  # a range
   bun src/health/tune.ts --apply                # save the new version if it passed
   bun src/health/summarize.ts FROM TO           # then rebuild past days
   ```

   On the server, prefix `docker compose exec dashboardify`.

## Fitting stages to you

The stage model's HRV, breathing and DFA α1 Gaussians start hand-set; `fit-stages.ts` fits them
to your nights. HR, movement, transitions and the time of night stay as the lab nights trained
them, which keeps each state's meaning. Code: `feedback/stage-em.ts`, `feedback/stage-fit.ts`.

- **EM.** Forward–backward in log space over every night in the range with the full model, then
  posterior-weighted means and SDs (null features skipped), until a round adds under 0.01 nats.
  MAP updates: the current values count as 200 epochs (100 min, about a night's deep), so one
  odd night moves a stage at most about halfway and a week outweighs it five to one.
- **Guardrails.** 5+ nights (some 4,000 epochs, and no night over a fifth of them); the
  literature's order kept (DFA deep < light < REM, HRV and breathing regularity deep > REM);
  SDs floored at 0.3; no mean moves over 0.5 per apply (capped, then checked); 75%+ of the nights
  plausible after. The report names the one that failed.
- **Params.** A `stages` section in the same `params/current.json`, so the `params_version`
  each row already records says which emissions staged it. Without one, the hand-set values.

```sh
bun src/health/fit-stages.ts                        # last 60 nights, report only
bun src/health/fit-stages.ts 2026-11-04 2026-11-09  # a range
bun src/health/fit-stages.ts --apply                # save the new version if it passed
bun src/health/summarize.ts FROM TO                 # then rebuild past days
```

On 4–9 Nov it was rejected: light fell under 35% on two nights. EM wants deep's HRV at −0.05
(light's is highest, 0.44) and sharper DFA (deep −0.91, REM 1.04), and calls more deep: shares
48/24/28 → 38/33/29 (light/deep/REM) after the cap.
With algo 13's beat joining (more beats in RMSSD, [health-metrics.md](health-metrics.md#hrv-hrvts))
it is still rejected, now with light under 35% on four nights: EM puts light's HRV at −0.50
(capped), deep's at 0.97 and REM's at −0.21, and calls more REM: 48/24/28 → 36/27/37.

## Next

Expected recovery from yesterday's strain and sleep debt, a "why?" question when a morning
surprises it, a weekly approve note in place of `--apply`, and tuning strain and sleep need the
same way.
