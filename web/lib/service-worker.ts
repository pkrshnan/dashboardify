// Registers web/public/sw.js, which shows reminders, and follows its taps: a tap on a reminder
// while the app is open asks it to go to the reminder's address.

import { navigate } from "./use-route";

export function startServiceWorker(container = navigator.serviceWorker): void {
  // Missing over plain http (the demo on a LAN address) and in old browsers; reminders need it.
  if (!container) {
    return;
  }
  container.register("/sw.js").catch((error: unknown) => {
    console.warn("service worker:", error);
  });
  container.addEventListener("message", (event: MessageEvent) => {
    const hash = openHash(event.data);
    if (hash) {
      navigate(hash);
    }
  });
}

/** The address in an `{type: "open", hash}` message from the worker, if it is one of ours. */
export function openHash(data: unknown): string | undefined {
  if (typeof data !== "object" || data === null) {
    return undefined;
  }
  const { type, hash } = data as { type?: unknown; hash?: unknown };
  return type === "open" && typeof hash === "string" && hash.startsWith("#/") ? hash : undefined;
}
