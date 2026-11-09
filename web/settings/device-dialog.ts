// The Devices section's dialogs, as plain state so the rules can be tested: a new token lives
// only in the "created" state, and closing drops it; revoking this device needs a tick first.

import type { DeviceView } from "../api";

export type Dialog =
  | { kind: "closed" }
  | { kind: "add"; name: string; error?: string }
  | { kind: "created"; displayName: string; token: string }
  | { kind: "revoke"; device: DeviceView; understood: boolean };

/** Closing forgets everything in the dialog, including a token still on screen. */
export function closed(): Dialog {
  return { kind: "closed" };
}

/** Another device: one confirmation. This one: only once "I'll be signed out" is ticked. */
export function canRevoke(dialog: Dialog): boolean {
  return dialog.kind === "revoke" && (!dialog.device.current || dialog.understood);
}

/** "Just now", "Today 09:10", "3 Nov", or "Never" for a device never used. */
export function whenLabel(iso: string | undefined, now: Date): string {
  if (!iso) {
    return "Never";
  }
  const at = new Date(iso);
  if (now.getTime() - at.getTime() < 2 * 60_000) {
    return "Just now";
  }
  const time = at.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
  if (at.toDateString() === now.toDateString()) {
    return `Today ${time}`;
  }
  return at.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
}
