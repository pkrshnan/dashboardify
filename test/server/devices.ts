// A fixed set of device tokens for tests that don't need settings.db.

import type { DeviceMatcher } from "../../src/settings/devices";

/** name → token, as INGEST_TOKENS used to give them. */
export function tokenDevices(tokens: Record<string, string>): DeviceMatcher {
  return {
    match: (token) => Object.entries(tokens).find(([, known]) => known === token)?.[0],
  };
}
