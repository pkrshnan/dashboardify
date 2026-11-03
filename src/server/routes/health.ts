import { Hono } from "hono";
import { localDate } from "../../vault/time";
import type { Checkin, Vault } from "../../vault/vault";
import type { AuthEnv } from "../auth";
import type { Config } from "../config";
import { type Body, badRequest, fail, isoDate, ok, type Parsed, readBody } from "../validate";

const MAX_TAGS = 10;
const MAX_TAG_LENGTH = 40;

/**
 * POST /health/checkin   record how you feel (1–5), a workout's effort (0–10) and tags in the
 *                        daily note. The feedback loop tunes recovery against these answers.
 */
export function healthRoutes(vault: Vault, config: Config): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/checkin", async (c) => {
    const body = (await readBody(c.req.raw)) ?? {};
    const date = isoDate(body.date, localDate(new Date(), config.timeZone));
    if (!date.ok) {
      return badRequest(c, date.error);
    }
    const checkin = parseCheckin(body);
    if (!checkin.ok) {
      return badRequest(c, checkin.error);
    }
    const result = await vault.recordCheckin(date.value, checkin.value);
    return c.json({ ...result, message: checkinMessage(checkin.value) }, 201);
  });

  return routes;
}

export function parseCheckin(body: Body): Parsed<Checkin> {
  const feel = wholeNumber(body.feel, "feel", 1, 5);
  const rpe = wholeNumber(body.rpe, "rpe", 0, 10);
  const tags = tagList(body.tags);
  if (!feel.ok) {
    return fail(feel.error);
  }
  if (!rpe.ok) {
    return fail(rpe.error);
  }
  if (!tags.ok) {
    return fail(tags.error);
  }
  const checkin: Checkin = { feel: feel.value, rpe: rpe.value, tags: tags.value };
  if (Object.values(checkin).every((v) => v === undefined)) {
    return fail("give at least one of feel, rpe or tags");
  }
  return ok(checkin);
}

/** An optional whole number from `min` to `max`. Shortcuts may send numbers as text. */
function wholeNumber(
  value: unknown,
  field: string,
  min: number,
  max: number,
): Parsed<number | undefined> {
  if (value === undefined || value === null || value === "") {
    return ok(undefined);
  }
  const n = typeof value === "string" ? Number(value) : value;
  if (typeof n !== "number" || !Number.isInteger(n) || n < min || n > max) {
    return fail(`${field} must be a whole number from ${min} to ${max}`);
  }
  return ok(n);
}

/** Optional tags: a list or a comma-separated string, stored lower-case. */
function tagList(value: unknown): Parsed<string[] | undefined> {
  if (value === undefined || value === null || value === "") {
    return ok(undefined);
  }
  const raw = typeof value === "string" ? value.split(",") : value;
  if (!(Array.isArray(raw) && raw.every((t) => typeof t === "string"))) {
    return fail("tags must be a list of words");
  }
  const tags = raw.map((t) => t.trim().toLowerCase()).filter((t) => t.length > 0);
  if (tags.length > MAX_TAGS || tags.some((t) => t.length > MAX_TAG_LENGTH)) {
    return fail(`at most ${MAX_TAGS} tags of ${MAX_TAG_LENGTH} characters`);
  }
  return ok(tags.length > 0 ? tags : undefined);
}

/** What Siri reads back. */
function checkinMessage(checkin: Checkin): string {
  const parts = [
    checkin.feel === undefined ? null : `feeling ${checkin.feel} out of 5`,
    checkin.rpe === undefined ? null : `effort ${checkin.rpe} out of 10`,
    checkin.tags ? checkin.tags.join(", ") : null,
  ];
  return `Logged ${parts.filter((p) => p !== null).join("; ")}.`;
}
