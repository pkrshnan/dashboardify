import { Hono } from "hono";
import { isIsoDate, localDate } from "../vault/time";
import { type HealthMetrics, Vault } from "../vault/vault";
import { type AuthEnv, bearerAuth } from "./auth";
import type { Config } from "./config";

const METRIC_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const RESERVED_KEYS = new Set(["date", "source", "tags"]);
const SOURCE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TEXT = 20_000;

export function createApp(config: Config, vault = new Vault(config.vaultPath, config.timeZone)) {
  const app = new Hono<AuthEnv>();

  app.get("/healthz", (c) => c.json({ ok: true }));

  const api = new Hono<AuthEnv>();
  api.use("*", bearerAuth(config.tokens));

  api.post("/ingest/journal", async (c) => {
    const body = await readJson(c.req.raw);
    const text = body?.text;
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "text is required" }, 400);
    if (text.length > MAX_TEXT) return c.json({ error: "text is too long" }, 400);
    const at = parseInstant(body.at);
    if (!at) return c.json({ error: "at must be an ISO timestamp" }, 400);
    return c.json(await vault.appendJournal(at, text), 201);
  });

  api.post("/ingest/health", async (c) => {
    const body = await readJson(c.req.raw);
    const date = body?.date ?? localDate(new Date(), config.timeZone);
    if (!isIsoDate(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    const source = body?.source ?? "apple-health";
    if (typeof source !== "string" || !SOURCE.test(source)) {
      return c.json({ error: "source must be a short lowercase slug" }, 400);
    }
    const raw = body?.metrics;
    if (!raw || typeof raw !== "object" || Array.isArray(raw))
      return c.json({ error: "metrics must be an object" }, 400);
    const metrics: HealthMetrics = {};
    for (const [k, v] of Object.entries(raw)) {
      if (!METRIC_KEY.test(k) || RESERVED_KEYS.has(k)) return c.json({ error: `bad metric name: ${k}` }, 400);
      const n = typeof v === "string" && v.trim() !== "" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) return c.json({ error: `metric ${k} must be a number` }, 400);
      metrics[k] = Math.round(n * 100) / 100;
    }
    if (Object.keys(metrics).length === 0) return c.json({ error: "metrics is empty" }, 400);
    return c.json(await vault.recordHealth(date, metrics, source), 201);
  });

  api.post("/ingest/messages", async (c) => {
    const body = await readJson(c.req.raw);
    const sender = body?.sender;
    const text = body?.text;
    if (typeof sender !== "string" || !sender.trim()) return c.json({ error: "sender is required" }, 400);
    if (typeof text !== "string" || !text.trim()) return c.json({ error: "text is required" }, 400);
    if (text.length > MAX_TEXT || sender.length > 200) return c.json({ error: "text is too long" }, 400);
    const receivedAt = parseInstant(body.received_at);
    if (!receivedAt) return c.json({ error: "received_at must be an ISO timestamp" }, 400);
    const id = typeof body.id === "string" && body.id.length <= 200 ? body.id : undefined;
    return c.json(await vault.appendMessage({ id, sender, text, receivedAt }), 201);
  });

  api.get("/today", async (c) => {
    const date = c.req.query("date") ?? localDate(new Date(), config.timeZone);
    if (!isIsoDate(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);
    const note = await vault.readDaily(date);
    return c.json({
      date,
      path: vault.dailyPath(date),
      frontmatter: note?.frontmatter ?? {},
      body: note?.body ?? null,
    });
  });

  app.route("/api", api);
  app.notFound((c) => c.json({ error: "not found" }, 404));
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}

// biome-ignore lint/suspicious/noExplicitAny: request bodies are validated field by field above.
async function readJson(req: Request): Promise<any> {
  try {
    return await req.json();
  } catch {
    return null;
  }
}

function parseInstant(value: unknown): Date | null {
  if (value === undefined) return new Date();
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
