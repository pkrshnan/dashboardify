// A value or an error message, for parsers that check untrusted input (uploads, params files)
// and want the caller to decide what an error means.

export type Parsed<T> = { ok: true; value: T } | { ok: false; error: string };

export function ok<T>(value: T): Parsed<T> {
  return { ok: true, value };
}

export function fail<T = never>(error: string): Parsed<T> {
  return { ok: false, error };
}

/** A plain JSON object, not an array or null. */
export function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
