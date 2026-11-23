// Sends one notification to a set of browsers, and forgets the ones the push service says are
// gone. Reminders and the Settings test both go through here.

import type { PushStore, Target } from "./push-store";
import { type SendOptions, send } from "./web-push";

/** What the service worker shows (web/public/sw.js reads these names). */
export interface PushMessage {
  title: string;
  body: string;
  /** A newer notification with the same tag replaces the older one on the phone. */
  tag: string;
  /** Where a tap goes, such as `/#/lists/tasks`. */
  url: string;
}

export interface Delivery {
  /** Seconds the push service keeps it for a phone that is offline. */
  ttl: number;
  urgency?: SendOptions["urgency"];
}

export interface PushResult {
  sent: number;
  failed: number;
}

export class Notifier {
  constructor(
    readonly store: PushStore,
    private readonly fetchPush?: (request: Request) => Promise<Response>,
    private readonly log: (line: string) => void = console.warn,
  ) {}

  async push(targets: Target[], message: PushMessage, delivery: Delivery): Promise<PushResult> {
    const keys = this.store.keys();
    const payload = JSON.stringify(message);
    const results = await Promise.all(
      targets.map(async (target) => {
        const result = await send(target, payload, {
          keys,
          subject: target.subject,
          ttl: delivery.ttl,
          urgency: delivery.urgency,
          fetch: this.fetchPush,
        });
        if (result.status === "gone") {
          this.store.remove(target.id);
        } else if (result.status === "failed") {
          // The endpoint is a secret, so only the subscription's name is logged.
          this.log(`push to ${target.displayName} failed: ${result.code} ${result.detail}`);
        }
        return result.status;
      }),
    );
    return {
      sent: results.filter((status) => status === "sent").length,
      failed: results.filter((status) => status !== "sent").length,
    };
  }
}
