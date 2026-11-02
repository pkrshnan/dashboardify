import { Hono } from "hono";
import type { Reminder } from "../vault/reminders";
import { isIsoDate, localDate, localTime } from "../vault/time";
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

  api.post("/ingest/reminders", async (c) => {
    const body = await readJson(c.req.raw);
    const mode = body?.mode ?? "full";
    if (mode !== "full" && mode !== "changes") return c.json({ error: 'mode must be "full" or "changes"' }, 400);
    if (!Array.isArray(body?.items)) return c.json({ error: "items must be an array" }, 400);
    if (body.items.length > 5000) return c.json({ error: "too many items" }, 400);
    const removed = body.removed_ids ?? [];
    if (!Array.isArray(removed) || !removed.every((id: unknown) => typeof id === "string")) {
      return c.json({ error: "removed_ids must be an array of strings" }, 400);
    }
    if (mode === "full" && removed.length) return c.json({ error: "removed_ids only applies to changes mode" }, 400);
    const items: Reminder[] = [];
    for (const r of body.items) {
      if (typeof r?.id !== "string" || !r.id || r.id.length > 200 || typeof r?.title !== "string") {
        return c.json({ error: "each item needs a string id and title" }, 400);
      }
      const due = parseDue(r.due, config.timeZone);
      if (due === null) return c.json({ error: `bad due for ${r.id}` }, 400);
      const list = typeof r.list === "string" ? r.list : "Reminders";
      if (r.completed === true) {
        // A completed reminder in a changes batch means "drop it"; in a full batch it is skipped.
        if (mode === "changes") removed.push(r.id);
        continue;
      }
      items.push({ id: r.id, title: r.title, list, ...due });
    }
    return c.json(await vault.syncReminders(mode, items, removed, new Date()), 200);
  });

  api.get("/ingest/reminders/state", async (c) => {
    const state = await vault.readState("reminders");
    return c.json({ last_sync: state?.last_sync ?? null });
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

/**
 * `undefined` -> no due date; "YYYY-MM-DD" -> all-day; an ISO timestamp -> local date and time.
 * Returns null when the value is present but unusable.
 */
function parseDue(value: unknown, timeZone: string): { dueDate?: string; dueTime?: string } | null {
  if (value === undefined || value === null || value === "") return {};
  if (typeof value !== "string") return null;
  if (isIsoDate(value)) return { dueDate: value };
  if (!/^\d{4}-\d{2}-\d{2}T/.test(value)) return null;
  const at = new Date(value);
  if (Number.isNaN(at.getTime())) return null;
  return { dueDate: localDate(at, timeZone), dueTime: localTime(at, timeZone) };
}

function parseInstant(value: unknown): Date | null {
  if (value === undefined) return new Date();
  if (typeof value !== "string") return null;
  const d = new Date(value);
  return Number.isNaN(d.getTime()) ? null : d;
}
