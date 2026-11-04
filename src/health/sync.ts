// When strap data last reached the server, so the UI and the daily note can show how far behind
// the health numbers are. RawStore records it on every stored upload in health-raw/sync.json.

/** Epoch ms. `latestSampleTs` is the newest sample stored, `uploadTs` when the last upload landed. */
export interface HealthSync {
  latestSampleTs: number;
  uploadTs: number;
}

/** PPG arrives every ~20 min while the strap is in range, so two hours without data is lagging. */
export const LAG_MS = 2 * 3_600_000;

/** Samples dated further ahead than this are a bad clock, not news, and never count as latest. */
const FUTURE_SLACK_MS = 10 * 60_000;

/** The sync record after an upload of samples with these timestamps arrives at `now`. */
export function nextSync(
  previous: HealthSync | null,
  timestamps: number[],
  now: number,
): HealthSync {
  let latest = previous?.latestSampleTs ?? 0;
  for (const ts of timestamps) {
    if (ts > latest && ts <= now + FUTURE_SLACK_MS) {
      latest = ts;
    }
  }
  return { latestSampleTs: latest, uploadTs: now };
}

/** How long the newest data is behind `now`, or null while it is within LAG_MS. */
export function lag(latestSampleTs: number, now: number): number | null {
  const behind = now - latestSampleTs;
  return behind > LAG_MS ? behind : null;
}

/** "45m", "5h" or "3d". */
export function shortDuration(ms: number): string {
  const minutes = Math.floor(ms / 60_000);
  if (minutes < 60) {
    return `${minutes}m`;
  }
  const hours = Math.floor(minutes / 60);
  return hours < 48 ? `${hours}h` : `${Math.floor(hours / 24)}d`;
}
