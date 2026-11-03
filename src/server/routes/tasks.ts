import Fuse from "fuse.js";
import type { Context } from "hono";
import { Hono } from "hono";
import type { FoundTask, NewTask, TaskStore } from "../../vault/task-store";
import type { Priority } from "../../vault/tasks";
import { localDate } from "../../vault/time";
import { parseWhen } from "../../vault/when";
import type { AuthEnv } from "../auth";
import type { Config } from "../config";
import {
  addedMessage,
  alreadyAddedMessage,
  completedMessage,
  type DueFilter,
  listMessage,
} from "../task-messages";
import {
  type Body,
  badRequest,
  fail,
  isoDate,
  MAX_ID_LENGTH,
  ok,
  type Parsed,
  readBody,
  requiredText,
} from "../validate";

const PRIORITIES = new Set<string>(["highest", "high", "medium", "low", "lowest"]);
const FILTERS = new Set<string>(["today", "overdue", "week", "all"]);
const MATCH_LIMIT = 5;

/**
 * POST /tasks                 capture a task into the inbox
 * GET  /tasks?due=…           open tasks due today, overdue, this week, or all
 * GET  /tasks/match?q=…       open tasks whose text is closest to q
 * POST /tasks/:id/complete    tick a task off (safe to retry)
 */
export function taskRoutes(store: TaskStore, config: Config): Hono<AuthEnv> {
  const routes = new Hono<AuthEnv>();
  const today = () => localDate(new Date(), config.timeZone);

  routes.post("/", async (c) => {
    const input = parseNewTask((await readBody(c.req.raw)) ?? {}, config.timeZone);
    if (!input.ok) {
      return badRequest(c, input.error);
    }
    const result = await store.add(input.value, today());
    const { task } = result.task;
    const message =
      result.status === "created" ? addedMessage(task, today()) : alreadyAddedMessage(task);
    return c.json(
      { status: result.status, ...view(result.task), message },
      result.status === "created" ? 201 : 200,
    );
  });

  routes.get("/", async (c) => {
    const filter = c.req.query("due") ?? "all";
    if (!FILTERS.has(filter)) {
      return badRequest(c, "due must be today, overdue, week or all");
    }
    const items = dueIn(await openTasks(store), filter as DueFilter, today());
    return c.json({
      items: items.map(view),
      message: listMessage(
        items.map((t) => t.task),
        filter as DueFilter,
      ),
    });
  });

  routes.get("/match", async (c) => {
    const q = requiredText(c.req.query("q"), "q", MAX_ID_LENGTH);
    if (!q.ok) {
      return badRequest(c, q.error);
    }
    const fuse = new Fuse(await openTasks(store), {
      keys: ["task.description"],
      includeScore: true,
    });
    const items = fuse.search(q.value, { limit: MATCH_LIMIT });
    return c.json({ items: items.map((m) => ({ ...view(m.item), score: m.score ?? 1 })) });
  });

  routes.post("/:id/complete", (c) => complete(c, store, today()));

  return routes;
}

async function complete(c: Context<AuthEnv>, store: TaskStore, today: string): Promise<Response> {
  const result = await store.complete(c.req.param("id") ?? "", today);
  if (result.status === "not_found") {
    return c.json({ status: "not_found", message: "I couldn't find that task." }, 404);
  }
  const next = result.status === "completed" ? result.next : undefined;
  return c.json({
    status: result.status,
    ...view(result.task),
    next: next ?? null,
    message: completedMessage(result.task.task, next, today),
  });
}

function parseNewTask(body: Body, timeZone: string): Parsed<NewTask> {
  const key = requiredText(body.key, "key", MAX_ID_LENGTH);
  const text = requiredText(body.text, "text");
  const fields = optionalFields(body);
  if (!key.ok) {
    return key;
  }
  if (!text.ok) {
    return text;
  }
  if (!fields.ok) {
    return fields;
  }
  const { due, time, priority } = fields.value;
  if (due) {
    return ok({ key: key.value, description: text.value.trim(), due, time, priority });
  }
  const spoken = parseWhen(text.value, new Date(), timeZone);
  return ok({ key: key.value, ...spoken, time: time ?? spoken.time, priority });
}

type Fields = Pick<NewTask, "due" | "time" | "priority">;

/** due, time and priority, each optional; whatever is set wins over dates found in the text. */
function optionalFields(body: Body): Parsed<Fields> {
  const due = body.due === undefined ? ok(undefined) : isoDate(body.due, "");
  if (!due.ok) {
    return fail("due must be YYYY-MM-DD");
  }
  const time = optionalTime(body.time);
  if (!time.ok) {
    return time;
  }
  const priority = optionalPriority(body.priority);
  if (!priority.ok) {
    return priority;
  }
  return ok({ due: due.value, time: time.value, priority: priority.value });
}

function optionalTime(value: unknown): Parsed<string | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || !/^([01]\d|2[0-3]):[0-5]\d$/.test(value)) {
    return fail("time must be HH:MM");
  }
  return ok(value);
}

function optionalPriority(value: unknown): Parsed<Priority | undefined> {
  if (value === undefined) {
    return ok(undefined);
  }
  if (typeof value !== "string" || !PRIORITIES.has(value)) {
    return fail("priority must be highest, high, medium, low or lowest");
  }
  return ok(value as Priority);
}

async function openTasks(store: TaskStore): Promise<FoundTask[]> {
  return (await store.list()).filter((t) => !t.task.done);
}

/** Tasks in the window, soonest first. */
function dueIn(tasks: FoundTask[], filter: DueFilter, today: string): FoundTask[] {
  const weekEnd = Temporal.PlainDate.from(today).add({ days: 6 }).toString();
  const inWindow: Record<DueFilter, (due: string) => boolean> = {
    today: (due) => due === today,
    overdue: (due) => due < today,
    week: (due) => due >= today && due <= weekEnd,
    all: () => true,
  };
  return tasks
    .filter((t) => (t.task.due ? inWindow[filter](t.task.due) : filter === "all"))
    .sort((a, b) => sortKey(a).localeCompare(sortKey(b)));
}

function sortKey(t: FoundTask): string {
  return `${t.task.due ?? "9999-99-99"} ${t.task.time ?? "99:99"} ${t.task.description}`;
}

function view(t: FoundTask) {
  return { id: t.ref, path: t.path, ...t.task };
}
