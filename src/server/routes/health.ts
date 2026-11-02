import { Hono } from "hono";
import { localDate } from "../../vault/time";
import type { HealthMetrics, Vault } from "../../vault/vault";
import type { AuthEnv } from "../auth";
import type { Config } from "../config";
import {
  type Body,
  badRequest,
  fail,
  isObject,
  isoDate,
  ok,
  type Parsed,
  readBody,
} from "../validate";

const METRIC_NAME = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_NAMES = new Set(["date", "source", "tags"]);
const SOURCE_SLUG = /^[a-z0-9][a-z0-9-]{0,39}$/;

interface HealthSummary {
  date: string;
  source: string;
  metrics: HealthMetrics;
}

/** POST /ingest/health: record one day's summary metrics from a source. */
export function healthRoutes(vault: Vault, config: Config): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/", async (c) => {
    const today = localDate(new Date(), config.timeZone);
    const summary = parseSummary((await readBody(c.req.raw)) ?? {}, today);
    if (!summary.ok) {
      return badRequest(c, summary.error);
    }
    const { date, metrics, source } = summary.value;
    return c.json(await vault.recordHealth(date, metrics, source), 201);
  });

  return routes;
}

function parseSummary(body: Body, today: string): Parsed<HealthSummary> {
  const date = isoDate(body.date, today);
  if (!date.ok) {
    return date;
  }
  const source = body.source ?? "apple-health";
  if (typeof source !== "string" || !SOURCE_SLUG.test(source)) {
    return fail("source must be a short lowercase slug");
  }
  const metrics = parseMetrics(body.metrics);
  if (!metrics.ok) {
    return metrics;
  }
  return ok({ date: date.value, source, metrics: metrics.value });
}

/** Metric names are snake_case; values are numbers or numeric strings, kept to 2 decimals. */
function parseMetrics(raw: unknown): Parsed<HealthMetrics> {
  if (!isObject(raw)) {
    return fail("metrics must be an object");
  }
  const metrics: HealthMetrics = {};
  for (const [name, value] of Object.entries(raw)) {
    if (!METRIC_NAME.test(name) || RESERVED_NAMES.has(name)) {
      return fail(`bad metric name: ${name}`);
    }
    const number = toNumber(value);
    if (number === null) {
      return fail(`metric ${name} must be a number`);
    }
    metrics[name] = Math.round(number * 100) / 100;
  }
  if (Object.keys(metrics).length === 0) {
    return fail("metrics is empty");
  }
  return ok(metrics);
}

function toNumber(value: unknown): number | null {
  const number = typeof value === "string" && value.trim() !== "" ? Number(value) : value;
  return typeof number === "number" && Number.isFinite(number) ? number : null;
}
