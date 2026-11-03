import { gunzipSync } from "node:zlib";
import { Hono } from "hono";
import { bodyLimit } from "hono/body-limit";
import type { RawStore } from "../../health/raw-store";
import { parseUpload } from "../../health/samples";
import { isIsoDate } from "../../vault/time";
import type { AuthEnv } from "../auth";
import { badRequest, fail, ok, type Parsed } from "../validate";

const STREAM = /^[a-z0-9_]{1,40}$/;
/** A day of 25 Hz PPG is well under this once gzipped. */
const MAX_UPLOAD_BYTES = 64 * 1024 * 1024;
const MAX_CSV_BYTES = 512 * 1024 * 1024;

/**
 * POST /ingest/samples/:stream?day=YYYY-MM-DD: merge a CSV of raw samples (gzipped or not)
 * into that stream's file for the UTC day.
 */
export function sampleRoutes(store: RawStore): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/:stream", bodyLimit({ maxSize: MAX_UPLOAD_BYTES }), async (c) => {
    const stream = c.req.param("stream");
    const day = c.req.query("day");
    if (!STREAM.test(stream)) {
      return badRequest(c, "stream must be a-z, 0-9 or _, up to 40 characters");
    }
    if (!isIsoDate(day)) {
      return badRequest(c, "day must be YYYY-MM-DD");
    }
    const csv = await readCsv(c.req.raw);
    if (!csv.ok) {
      return badRequest(c, csv.error);
    }
    const upload = parseUpload(csv.value, day);
    if (!upload.ok) {
      return badRequest(c, upload.error);
    }
    const result = await store.store(stream, day, upload.value);
    return result.ok ? c.json(result.value) : badRequest(c, result.error);
  });

  return routes;
}

async function readCsv(req: Request): Promise<Parsed<string>> {
  const bytes = new Uint8Array(await req.arrayBuffer());
  if (req.headers.get("content-encoding") !== "gzip") {
    return ok(new TextDecoder().decode(bytes));
  }
  try {
    return ok(new TextDecoder().decode(gunzipSync(bytes, { maxOutputLength: MAX_CSV_BYTES })));
  } catch {
    return fail("body is not valid gzip, or is too large once unzipped");
  }
}
