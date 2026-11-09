// For services with INPUT_ONLY secrets (calendar passwords, link URLs) and one-time values
// (device tokens): a written secret must never come back in a response.

import { expect } from "bun:test";

/** Fails if any response body contains `secret`, however it is nested or encoded. */
export function expectNotInResponses(bodies: unknown[], secret: string): void {
  for (const body of bodies) {
    expect(JSON.stringify(body)).not.toContain(secret);
  }
}
