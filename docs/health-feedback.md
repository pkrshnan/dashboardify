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

## Next

Expected recovery from yesterday's strain and sleep debt, a "why?" question when a morning
surprises it, a weekly approve note in place of `--apply`, and tuning strain and sleep need the
same way.
