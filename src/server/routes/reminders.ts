import { Hono } from "hono";
import type { Reminder } from "../../vault/reminders";
import { isIsoDate, localDate, localTime } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import type { AuthEnv } from "../auth";
import type { Config } from "../config";
import { type Body, badRequest, fail, MAX_ID_LENGTH, ok, type Parsed, readBody } from "../validate";

const MAX_ITEMS = 5000;

type SyncMode = "full" | "changes";

interface ReminderSync {
  mode: SyncMode;
  upserts: Reminder[];
  removedIds: string[];
}

type Due = Pick<Reminder, "dueDate" | "dueTime">;

/**
 * POST /ingest/reminders: mirror Apple Reminders into the vault.
 * GET  /ingest/reminders/state: when the last sync ran, so the phone can send only changes.
 */
export function reminderRoutes(vault: Vault, config: Config): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();

  routes.post("/", async (c) => {
    const sync = parseSync((await readBody(c.req.raw)) ?? {}, config.timeZone);
    if (!sync.ok) {
      return badRequest(c, sync.error);
    }
    const { mode, upserts, removedIds } = sync.value;
    return c.json(await vault.syncReminders(mode, upserts, removedIds, new Date()));
  });

  routes.get("/state", async (c) => {
    const state = await vault.readState("reminders");
    return c.json({ last_sync: state?.last_sync ?? null });
  });

  return routes;
}

function parseSync(body: Body, timeZone: string): Parsed<ReminderSync> {
  const mode = body.mode ?? "full";
  if (mode !== "full" && mode !== "changes") {
    return fail('mode must be "full" or "changes"');
  }
  if (!Array.isArray(body.items)) {
    return fail("items must be an array");
  }
  if (body.items.length > MAX_ITEMS) {
    return fail("too many items");
  }
  const removedIds = parseRemovedIds(body.removed_ids, mode);
  if (!removedIds.ok) {
    return removedIds;
  }
  return parseItems(body.items, mode, removedIds.value, timeZone);
}

function parseRemovedIds(value: unknown, mode: SyncMode): Parsed<string[]> {
  const ids = value ?? [];
  if (!(Array.isArray(ids) && ids.every((id) => typeof id === "string"))) {
    return fail("removed_ids must be an array of strings");
  }
  if (mode === "full" && ids.length > 0) {
    return fail("removed_ids only applies to changes mode");
  }
  return ok(ids);
}

/**
 * Split items into reminders to keep and IDs to drop. A completed reminder in a changes batch
 * means "drop it"; in a full batch it is simply left out.
 */
function parseItems(
  items: unknown[],
  mode: SyncMode,
  removedIds: string[],
  timeZone: string,
): Parsed<ReminderSync> {
  const upserts: Reminder[] = [];
  const removed = [...removedIds];
  for (const item of items) {
    const reminder = parseItem(item, timeZone);
    if (!reminder.ok) {
      return reminder;
    }
    const isCompleted = (item as Body).completed === true;
    if (!isCompleted) {
      upserts.push(reminder.value);
    } else if (mode === "changes") {
      removed.push(reminder.value.id);
    }
  }
  return ok({ mode, upserts, removedIds: removed });
}

function parseItem(item: unknown, timeZone: string): Parsed<Reminder> {
  const { id, title, list, due } = (item ?? {}) as Body;
  if (
    typeof id !== "string" ||
    id === "" ||
    id.length > MAX_ID_LENGTH ||
    typeof title !== "string"
  ) {
    return fail("each item needs a string id and title");
  }
  const parsedDue = parseDue(due, timeZone);
  if (parsedDue === null) {
    return fail(`bad due for ${id}`);
  }
  return ok({ id, title, list: typeof list === "string" ? list : "Reminders", ...parsedDue });
}

/**
 * Missing means no due date, "YYYY-MM-DD" is all-day, and an ISO timestamp becomes a local
 * date and time. Returns null when the value is present but unusable.
 */
function parseDue(value: unknown, timeZone: string): Due | null {
  if (value === undefined || value === null || value === "") {
    return {};
  }
  if (typeof value !== "string") {
    return null;
  }
  if (isIsoDate(value)) {
    return { dueDate: value };
  }
  const at = /^\d{4}-\d{2}-\d{2}T/.test(value) ? new Date(value) : null;
  if (at === null || Number.isNaN(at.getTime())) {
    return null;
  }
  return { dueDate: localDate(at, timeZone), dueTime: localTime(at, timeZone) };
}
