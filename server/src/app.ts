import { timingSafeEqual } from "node:crypto";
import { Hono, type MiddlewareHandler } from "hono";
import type { Config } from "./config";
import { isIsoDate, localDate } from "./time";
import { Vault, type HealthMetrics, type Reminder } from "./vault";

type Env = { Variables: { device: string } };

const METRIC_KEY = /^[a-z][a-z0-9_]{0,39}$/;
const SOURCE = /^[a-z0-9][a-z0-9-]{0,39}$/;
const MAX_TEXT = 20_000;

export function createApp(config: Config, vault = new Vault(config.vaultPath, config.timeZone)) {
  const app = new Hono<Env>();

  app.get("/healthz", (c) => c.json({ ok: true }));

  const api = new Hono<Env>();
  api.use("*", bearerAuth(config.tokens));

  // ---- ingest ------------------------------------------------------------

  api.post("/ingest/journal", async (c) => {
    const body = await readJson(c.req.raw);
    const text = body?.text;
    if (typeof text !== "string" || !text.trim()) return bad(c, "text is required");
    if (text.length > MAX_TEXT) return bad(c, "text is too long");
    const at = parseInstant(body.at);
    if (!at) return bad(c, "at must be an ISO timestamp");
    return c.json(await vault.appendJournal(at, text), 201);
  });

  api.post("/ingest/health", async (c) => {
    const body = await readJson(c.req.raw);
    const date = body?.date ?? localDate(new Date(), config.timeZone);
    if (!isIsoDate(date)) return bad(c, "date must be YYYY-MM-DD");
    const source = body?.source ?? "apple-health";
    if (typeof source !== "string" || !SOURCE.test(source)) return bad(c, "source must be a short lowercase slug");
    const metrics: HealthMetrics = {};
    const raw = body?.metrics;
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) return bad(c, "metrics must be an object");
    for (const [k, v] of Object.entries(raw)) {
      if (!METRIC_KEY.test(k) || k === "date" || k === "source" || k === "tags") return bad(c, `bad metric name: ${k}`);
      const n = typeof v === "string" ? Number(v) : v;
      if (typeof n !== "number" || !Number.isFinite(n)) return bad(c, `metric ${k} must be a number`);
      metrics[k] = Math.round(n * 100) / 100;
    }
    if (Object.keys(metrics).length === 0) return bad(c, "metrics is empty");
    return c.json(await vault.recordHealth(date, metrics, source), 201);
  });

  api.post("/ingest/reminders", async (c) => {
    const body = await readJson(c.req.raw);
    if (!Array.isArray(body?.items)) return bad(c, "items must be an array");
    const items: Reminder[] = [];
    for (const r of body.items) {
      if (typeof r?.id !== "string" || typeof r?.title !== "string") return bad(c, "each item needs id and title");
      const due = typeof r.due === "string" ? r.due.slice(0, 10) : undefined;
      if (due !== undefined && !isIsoDate(due)) return bad(c, `bad due date for ${r.id}`);
      items.push({ id: r.id, title: r.title, list: typeof r.list === "string" ? r.list : undefined, due, completed: r.completed === true });
    }
    return c.json(await vault.mirrorReminders(items, new Date()), 201);
  });

  api.post("/ingest/messages", async (c) => {
    const body = await readJson(c.req.raw);
    const { sender, text } = body ?? {};
    if (typeof sender !== "string" || !sender.trim()) return bad(c, "sender is required");
    if (typeof text !== "string" || !text.trim()) return bad(c, "text is required");
    if (text.length > MAX_TEXT) return bad(c, "text is too long");
    const receivedAt = parseInstant(body.received_at);
    if (!receivedAt) return bad(c, "received_at must be an ISO timestamp");
    const id = typeof body.id === "string" ? body.id : undefined;
    return c.json(await vault.appendMessage({ id, sender, text, receivedAt }), 201);
  });

  // ---- read --------------------------------------------------------------

  api.get("/today", async (c) => {
    const date = c.req.query("date") ?? localDate(new Date(), config.timeZone);
    if (!isIsoDate(date)) return bad(c, "date must be YYYY-MM-DD");
    const note = await vault.readDaily(date);
    return c.json({ date, path: vault.dailyPath(date), frontmatter: note?.frontmatter ?? {}, body: note?.body ?? null });
  });

  app.route("/api", api);
  app.onError((err, c) => {
    console.error(err);
    return c.json({ error: "internal error" }, 500);
  });
  return app;
}

// ---- helpers ---------------------------------------------------------------

function bearerAuth(tokens: Map<string, string>): MiddlewareHandler<Env> {
  const entries = [...tokens.entries()].map(([device, token]) => [device, Buffer.from(token)] as const);
  return async (c, next) => {
    const header = c.req.header("authorization") ?? "";
    const given = Buffer.from(header.startsWith("Bearer ") ? header.slice(7) : "");
    const match = entries.find(([, t]) => t.length === given.length && timingSafeEqual(t, given));
    if (!match) return c.json({ error: "unauthorized" }, 401);
    c.set("device", match[0]);
    await next();
  };
}

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

function bad(c: { json: (b: unknown, s: 400) => Response }, error: string) {
  return c.json({ error }, 400);
}
