// Who is making the current request, for code below the transport that only sees the request
// message (DeviceService marks the caller's own device as `current`).

import { AsyncLocalStorage } from "node:async_hooks";

const storage = new AsyncLocalStorage<{ device: string }>();

export function withDevice<T>(device: string, fn: () => Promise<T>): Promise<T> {
  return storage.run({ device }, fn);
}

/** The device id from sign-in, or `tailnet:<login>`; undefined outside a request. */
export function currentDevice(): string | undefined {
  return storage.getStore()?.device;
}
