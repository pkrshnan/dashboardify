// Small helpers for checking request bodies. Each parser returns either a value or an error
// message, so a route reads as a list of fields followed by one "if invalid, return 400".

import type { Context } from "hono";
import { isIsoDate } from "../vault/time";

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export const MAX_TEXT_LENGTH = 20_000;
export const MAX_ID_LENGTH = 200;

export function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: string): Parsed<T> {
  return { ok: false, error };
}

/** Respond 400 with the parser's error message. */
export function badRequest(c: Context, error: string): Response {
  return c.json({ error }, 400);
}

/** A loosely-typed JSON object. Fields are checked one by one by the route. */
export type Body = Record<string, unknown>;

/** Parse the request body as a JSON object, or null when it isn't one. */
export async function readBody(req: Request): Promise<Body | null> {
  try {
    const value: unknown = await req.json();
    return isObject(value) ? value : null;
  } catch {
    return null;
  }
}

export function isObject(value: unknown): value is Body {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Non-blank text, at most `maxLength` characters. */
export function requiredText(
  value: unknown,
  field: string,
  maxLength = MAX_TEXT_LENGTH,
): Parsed<string> {
  if (typeof value !== "string" || value.trim() === "") {
    return fail(`${field} is required`);
  }
  if (value.length > maxLength) {
    return fail(`${field} is too long`);
  }
  return ok(value);
}

/** An ISO timestamp. Missing means "now". */
export function instant(value: unknown, field: string): Parsed<Date> {
  if (value === undefined) {
    return ok(new Date());
  }
  const date = typeof value === "string" ? new Date(value) : null;
  if (date === null || Number.isNaN(date.getTime())) {
    return fail(`${field} must be an ISO timestamp`);
  }
  return ok(date);
}

/** A YYYY-MM-DD date. Missing means `fallback`. */
export function isoDate(value: unknown, fallback: string): Parsed<string> {
  const date = value ?? fallback;
  if (typeof date !== "string" || !isIsoDate(date)) {
    return fail("date must be YYYY-MM-DD");
  }
  return ok(date);
}

/** An optional short id, used for de-duplication. Anything unusable is ignored. */
export function optionalId(value: unknown): string | undefined {
  if (typeof value === "string" && value.length <= MAX_ID_LENGTH) {
    return value;
  }
  return undefined;
}
