// Who is making the current request, for code below the transport that only sees the request
// message (DeviceService marks the caller's own device as `current`; Web Push names the address
// the web app was loaded from).

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ device: string; origin?: string }>();

export function withDevice<T>(device: string, fn: () => Promise<T>, origin?: string): Promise<T> {
  return storage.run({ device, origin }, fn);
}

/** The device id from sign-in, or `tailnet:<login>`; undefined outside a request. */
export function currentDevice(): string | undefined {
  return storage.getStore()?.device;
}

/** The address the web app was loaded from, such as `https://dash.tailnet.ts.net`. */
export function currentOrigin(): string | undefined {
  return storage.getStore()?.origin;
}
