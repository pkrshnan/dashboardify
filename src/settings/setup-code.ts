// The one-time code that lets a fresh install be signed into from a browser, with no CLI step.
// It is printed at startup only when there is no device and no tailnet sign-in, kept in memory
// only, and works once, for 15 minutes, and only to add a device.

import { randomInt, timingSafeEqual } from "node:crypto";

/** No 0/O, 1/I/L or U, so it reads back without mistakes. */
const ALPHABET = "23456789ABCDEFGHJKMNPQRSTVWXYZ";
const LENGTH = 8;
const LIFETIME_MS = 15 * 60_000;

export class SetupCode {
  private code?: string;
  private expires = 0;

  constructor(private readonly now: () => Date = () => new Date()) {}

  /** A new code, replacing any earlier one. Shown as "4KQ7-MZ2D". */
  issue(): string {
    this.code = Array.from({ length: LENGTH }, () => ALPHABET[randomInt(ALPHABET.length)]).join("");
    this.expires = this.now().getTime() + LIFETIME_MS;
    return `${this.code.slice(0, 4)}-${this.code.slice(4)}`;
  }

  /** Whether a code is waiting to be used. */
  active(): boolean {
    return Boolean(this.code) && this.now().getTime() < this.expires;
  }

  /** True for the live code, once: using it ends it. Case and the dash don't matter. */
  redeem(given: string): boolean {
    if (!(this.code && this.active())) {
      return false;
    }
    const typed = Buffer.from(given.toUpperCase().replace(/[^A-Z0-9]/g, ""));
    const expected = Buffer.from(this.code);
    if (typed.length !== expected.length || !timingSafeEqual(typed, expected)) {
      return false;
    }
    this.code = undefined;
    return true;
  }
}
