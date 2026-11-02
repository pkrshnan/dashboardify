# Vault format

Exactly what the server writes, so you can read or edit the files by hand without breaking anything.

## Rules

- The server only touches what it owns: frontmatter keys it was sent, lines it appends to `## Journal` and `## Received`, and regions between `<!-- cc:name -->` and `<!-- /cc:name -->`. Everything else in a file is left exactly as it is.
- Every write is atomic (temp file, then rename), and writes to the same file never overlap.
- A write that would not change a file is skipped, so git history only records real changes.
- Days follow the server's time zone (`TZ_NAME`), so a line logged at 23:30 lands in that day's note, even around daylight saving changes.

## Daily note: `daily/YYYY/YYYY-MM-DD.md`

```markdown
---
date: 2026-11-02
tags:
  - daily
recovery: 41
sleep_h: 5.9
---
# 2026-11-02

## Journal

- 07:55 Gym felt heavy.
- 22:10 Long day. Lease still not signed.
  Second line of the same entry.
```

Health metrics are merged into the frontmatter. Journal entries are `- HH:MM text`, and continuation lines are indented two spaces.

## Health: `health/YYYY/YYYY-MM.csv`

One row per day. Columns are `date`, then the metric names sorted, then `source`. Sending the same day again updates that row.

```csv
date,hrv_ms,recovery,steps,source
2026-11-01,,,8412,apple-health
2026-11-02,58.24,70,,whoop
```

## Messages: `inbox/messages/YYYY-MM-DD.md`

Marked `privacy: local-only`, so a cloud model never sees them. Each line ends with the message's ID so a resend is ignored.

```markdown
## Received

- 12:05 **Sam**: Moved dinner to 19:00. <!-- id:m1 -->
```
