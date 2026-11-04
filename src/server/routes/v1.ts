import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import Fuse from "fuse.js";
import { defined } from "../../defined";
import type { RawStore } from "../../health/raw-store";
import type { Upload } from "../../health/samples";
import { type HomeDeps, homeView } from "../../home/home";
import { editNote } from "../../vault/markdown";
import { type FoundTask, shortHash, type TaskStore } from "../../vault/task-store";
import type { Priority, Task } from "../../vault/tasks";
import { isIsoDate, localDate, localTime } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import { parseWhen } from "../../vault/when";
import { addedMessage, completedMessage, listMessage } from "../task-messages";
import { legacyMessages } from "./v1-messages";
// JSON is normalized against the generated protobuf descriptors at the transport boundary.
// biome-ignore lint/suspicious/noExplicitAny: dynamic protobuf JSON object
export type Json = Record<string, any>;
const invalid = (message: string): never => {
  throw new ApiError(400, message);
};
export class ApiError extends Error {
  constructor(
    readonly status: number,
    message: string,
  ) {
    super(message);
  }
}
const text = (s: unknown): string =>
  typeof s === "string" && s.trim() && s.length <= 20000
    ? s
    : invalid("text is required (maximum 20000 characters)");
export const dateObject = (s: string) => {
  const [year, month, day] = s.split("-").map(Number);
  return { year, month, day };
};
const dateString = (d: Json): string => {
  const s = `${d.year}-${String(d.month).padStart(2, "0")}-${String(d.day).padStart(2, "0")}`;
  return isIsoDate(s) ? s : invalid("invalid date");
};
export const timeObject = (s: string) => {
  const [hours, minutes] = s.split(":").map(Number);
  return { hours, minutes };
};
const timeString = (t: Json) => {
  if (
    !(Number.isInteger(t.hours ?? 0) && Number.isInteger(t.minutes ?? 0)) ||
    (t.hours ?? 0) < 0 ||
    t.hours > 23 ||
    (t.minutes ?? 0) < 0 ||
    t.minutes > 59 ||
    t.seconds ||
    t.nanos
  ) {
    invalid("invalid time");
  }
  return `${String(t.hours ?? 0).padStart(2, "0")}:${String(t.minutes ?? 0).padStart(2, "0")}`;
};
function page(items: Json[], q: Json) {
  const size = Number(q.pageSize || 50);
  if (!Number.isInteger(size) || size < 1) {
    invalid("invalid page size");
  }
  let offset = 0;
  if (q.pageToken) {
    try {
      offset = Number(Buffer.from(q.pageToken, "base64url").toString());
    } catch {
      invalid("invalid page token");
    }
    if (!Number.isSafeInteger(offset) || offset < 0) {
      invalid("invalid page token");
    }
  }
  const end = offset + Math.min(size, 500);
  return {
    items: items.slice(offset, end),
    nextPageToken: end < items.length ? Buffer.from(String(end)).toString("base64url") : "",
  };
}
function masks(q: Json, value: Json, allowed: string[]) {
  const fields: string[] = q.updateMask
    ? q.updateMask
        .split(",")
        .map((s: string) => s.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase()))
    : Object.keys(value).filter((k) => allowed.includes(k));
  const result = fields.includes("*") ? allowed : fields;
  if (result.some((k) => !allowed.includes(k))) {
    invalid("invalid update mask");
  }
  return result;
}
function filter(input: Json[], expression: string | undefined, allowed: string[]) {
  let items = input;
  if (!expression) {
    return items;
  }
  for (const part of expression.split(/\s+AND\s+/)) {
    const m = part.match(/^([a-z_]+)\s*(<=|>=|!=|=|<|>)\s*(?:"([^"]*)"|([A-Z_]+))$/);
    if (!(m && allowed.includes(defined(m[1])))) {
      invalid("unsupported filter");
    }
    const [, key, op, quoted, bare] = defined(m);
    const value = quoted ?? bare;
    items = items.filter((t) => {
      const a = t[defined(key)];
      if (a == null) {
        return false;
      }
      switch (op) {
        case "=":
          return a === value;
        case "!=":
          return a !== value;
        case "<":
          return a < defined(value);
        case ">":
          return a > defined(value);
        case "<=":
          return a <= defined(value);
        default:
          return a >= defined(value);
      }
    });
  }
  return items;
}
// biome-ignore lint/complexity/noExcessiveLinesPerFunction: service registry shares a single set of vault-backed helpers across all RPC implementations
export function v1Services(
  vault: Vault,
  tasks: TaskStore,
  raw: RawStore,
  home: HomeDeps,
  now = () => new Date(),
  onSamples: (stream: string, day: string) => void = () => undefined,
) {
  const today = () => localDate(now(), vault.timeZone);
  const taskView = async (t: FoundTask): Promise<Json> => ({
    name: `tasks/${t.ref}`,
    description: t.task.description,
    state: t.task.done ? "STATE_DONE" : "STATE_OPEN",
    dueDate: optionalDate(t.task.due),
    dueTime: t.task.time ? timeObject(t.task.time) : undefined,
    priority: t.task.priority
      ? `PRIORITY_${t.task.priority.toUpperCase()}`
      : "PRIORITY_UNSPECIFIED",
    recurrence: t.task.recurrence ?? "",
    createDate: optionalDate(t.task.created),
    completeDate: optionalDate(t.task.completed),
    path: t.path,
    etag: await tasks.etag(t),
  });
  const getTask = async (name: string) => {
    const t = (await tasks.list()).find((t) => `tasks/${t.ref}` === name);
    if (!t) {
      throw new ApiError(404, "task not found");
    }
    return t;
  };
  const dayOf = (name: string) => {
    const m = /^days\/(\d{4}-\d{2}-\d{2})(?:\/checkin)?$/.exec(name ?? "");
    if (!(m && isIsoDate(m[1]))) {
      invalid("invalid day name");
    }
    return defined(m?.[1]);
  };
  const priority = (p: string | undefined): Priority | undefined => {
    if (!p || p === "PRIORITY_UNSPECIFIED") {
      return undefined;
    }
    const v = p.replace("PRIORITY_", "").toLowerCase();
    if (!["lowest", "low", "medium", "high", "highest"].includes(v)) {
      invalid("invalid priority");
    }
    return v as Priority;
  };
  const entries = async (day: string, includeMarkers = false): Promise<Json[]> => {
    const note = await vault.readDaily(day);
    const section = note?.body.split(/^## Journal\s*$/m)[1]?.split(/^## /m)[0] ?? "";
    const counts = new Map<string, number>();
    return [...section.matchAll(/^- (\d{2}:\d{2}) (.*(?:\n {2}.*)*)/gm)].map((m) => {
      const key = defined(m[1]).replace(":", "");
      const n = (counts.get(key) ?? 0) + 1;
      counts.set(key, n);
      return {
        name: `days/${day}/journalEntries/${key}-${n}`,
        text: (includeMarkers
          ? defined(m[2])
          : defined(m[2]).replace(/ <!-- request:[a-f0-9]+ -->$/, "")
        ).replace(/\n {2}/g, "\n"),
        entryTime: Temporal.PlainDateTime.from(`${day}T${m[1]}`)
          .toZonedDateTime(vault.timeZone)
          .toInstant()
          .toString(),
      };
    });
  };
  const checkin = async (day: string) => {
    const fm = (await vault.readDaily(day))?.frontmatter ?? {};
    return {
      name: `days/${day}/checkin`,
      feel: fm.feel,
      rpe: fm.effort_rpe,
      tags: fm.health_tags ?? [],
      etag: shortHash(JSON.stringify(fm)),
    };
  };
  const stream = async (name: string) => {
    if (!/^streams\/[a-z0-9_]{1,40}$/.test(name ?? "")) {
      invalid("invalid stream name");
    }
    const columns = await raw.readColumns(name.slice(8));
    if (!columns) {
      throw new ApiError(404, "stream not found");
    }
    return {
      name,
      columns: columns.map((c) => ({
        name: c.name,
        type:
          ({ number: "TYPE_NUMBER", text: "TYPE_TEXT" } as Record<string, string>)[c.type ?? ""] ??
          "TYPE_UNSPECIFIED",
      })),
    };
  };
  const methods: Record<string, (q: Json) => Promise<Json>> = {
    getTask: async (q) => taskView(await getTask(q.name)),
    listTasks: async (q) => {
      let rows = await Promise.all((await tasks.list()).map(taskView));
      const knownNames = new Set(rows.map((t) => t.name));
      rows.push(...(await legacyMessages(vault)).filter((t) => !knownNames.has(t.name)));
      rows = filter(
        rows.map((t) => ({ ...t, due_date: t.dueDate ? dateString(t.dueDate) : undefined })),
        q.filter,
        ["state", "due_date"],
      );
      const orders = (q.orderBy || "due_date, due_time, description")
        .split(",")
        .map((s: string) => s.trim().split(/\s+/));
      if (
        orders.some(
          ([k, d]: string[]) =>
            !["due_date", "due_time", "description"].includes(defined(k)) ||
            (d && d !== "desc" && d !== "asc"),
        )
      ) {
        invalid("invalid order_by");
      }
      rows.sort((a, b) => compareTasks(a, b, orders));
      const p = page(rows, q);
      return { tasks: p.items.map(({ due_date, ...t }) => t), nextPageToken: p.nextPageToken };
    },
    createTask: async (q) => {
      const t = q.task ?? {};
      const result = await tasks.add(
        {
          key: q.requestId || randomUUID(),
          description: text(t.description).trim(),
          due: t.dueDate ? dateString(t.dueDate) : undefined,
          time: t.dueTime ? timeString(t.dueTime) : undefined,
          priority: priority(t.priority),
          recurrence: t.recurrence,
        },
        today(),
      );
      return taskView(result.task);
    },
    updateTask: async (q) => {
      const t = q.task;
      await getTask(t?.name);
      const fields = masks(q, t, ["description", "dueDate", "dueTime", "priority", "recurrence"]);
      const setters: Record<string, (old: Task) => void> = {
        description: (old) => {
          old.description = text(t.description);
        },
        dueDate: (old) => {
          old.due = t.dueDate ? dateString(t.dueDate) : undefined;
        },
        dueTime: (old) => {
          old.time = t.dueTime ? timeString(t.dueTime) : undefined;
        },
        priority: (old) => {
          old.priority = priority(t.priority);
        },
        recurrence: (old) => {
          old.recurrence = t.recurrence || undefined;
        },
      };
      const result = await tasks.edit(t.name.slice(6), t.etag, (old) => {
        for (const field of fields) {
          defined(setters[field])(old);
        }
        return old;
      });
      return taskView(defined(result));
    },
    deleteTask: async (q) => {
      const t = await getTask(q.name);
      await tasks.edit(t.ref, q.etag, () => null);
      return {};
    },
    completeTask: async (q) => {
      const t = await getTask(q.name);
      const result = await tasks.complete(t.ref, today(), q.etag);
      if (result.status === "not_found") {
        throw new ApiError(404, "task not found");
      }
      return {
        task: await taskView(result.task),
        nextTask:
          result.status === "completed" && result.next
            ? await taskView({ ref: defined(result.next.id), path: t.path, task: result.next })
            : undefined,
      };
    },
    reopenTask: async (q) => {
      const t = await getTask(q.name);
      return taskView(
        defined(
          await tasks.edit(t.ref, q.etag, (task) => ({
            ...task,
            done: false,
            completed: undefined,
          })),
        ),
      );
    },
    searchTasks: async (q) => {
      const fuse = new Fuse(
        (await tasks.list()).filter((t) => !t.task.done),
        { keys: ["task.description"], includeScore: true },
      );
      return {
        matches: await Promise.all(
          fuse
            .search(text(q.query), { limit: Math.min(Number(q.pageSize || 5), 500) })
            .map(async (m) => ({ task: await taskView(m.item), score: m.score ?? 1 })),
        ),
      };
    },
    getDay: async (q) => {
      const day = dayOf(q.name);
      const note = await vault.readDaily(day);
      return {
        name: q.name,
        path: vault.dailyPath(day),
        frontmatter: note?.frontmatter ?? {},
        body: note?.body,
      };
    },
    getCheckin: async (q) => checkin(dayOf(q.name)),
    updateCheckin: async (q) => {
      const t = q.checkin ?? {};
      const day = dayOf(t.name);
      const fields = masks(q, t, ["feel", "rpe", "tags"]);
      await vault.update(vault.dailyPath(day), (source) =>
        editNote(
          source,
          { frontmatter: { date: day, tags: ["daily"] }, body: `# ${day}\n\n## Journal\n` },
          (note) => {
            if (t.etag && shortHash(JSON.stringify(note.frontmatter)) !== t.etag) {
              throw new ApiError(409, "stale etag");
            }
            applyCheckin(note.frontmatter, t, fields);
            return note;
          },
        ),
      );
      return checkin(day);
    },
    listJournalEntries: async (q) => {
      const p = page(await entries(dayOf(q.parent)), q);
      return { journalEntries: p.items, nextPageToken: p.nextPageToken };
    },
    createJournalEntry: async (q) => {
      const day = dayOf(q.parent);
      const t = q.journalEntry ?? {};
      const at = t.entryTime
        ? new Date(t.entryTime)
        : new Date(
            Temporal.PlainDateTime.from(
              `${day}T${localTime(now(), vault.timeZone)}`,
            ).toZonedDateTime(vault.timeZone).epochMilliseconds,
          );
      if (Number.isNaN(at.getTime()) || localDate(at, vault.timeZone) !== day) {
        invalid("entry_time must fall in parent day");
      }
      const value = text(t.text);
      const marker = q.requestId ? ` <!-- request:${shortHash(q.requestId)} -->` : "";
      const path = vault.dailyPath(day);
      const time = localTime(at, vault.timeZone);
      await vault.update(path, (source) => {
        if (marker && source?.includes(marker)) {
          return null;
        }
        return editNote(
          source,
          { frontmatter: { date: day, tags: ["daily"] }, body: `# ${day}\n\n## Journal\n` },
          (note) => {
            const line = `- ${time} ${value.trim().replace(/\r?\n/g, "\n  ")}${marker}\n`;
            const section = note.body.indexOf("## Journal");
            if (section < 0) {
              note.body += `\n## Journal\n${line}`;
            } else {
              const end = note.body.indexOf("\n## ", section + 10);
              const i = end < 0 ? note.body.length : end;
              note.body = `${note.body.slice(0, i).trimEnd()}\n${line}${note.body.slice(i)}`;
            }
            return note;
          },
        );
      });
      const all = await entries(day, true);
      const entry = all.find((e) => marker && e.text.includes(marker)) ?? defined(all.at(-1));
      return { ...entry, text: entry.text.replace(/ <!-- request:[a-f0-9]+ -->$/, "") };
    },
    createMessage: async (q) => {
      const m = q.message ?? {};
      const receiveTime = new Date(m.receiveTime);
      if (Number.isNaN(receiveTime.getTime())) {
        invalid("receive_time is required");
      }
      const id = q.messageId || randomUUID();
      if (!/^[A-Za-z0-9_-]{1,200}$/.test(id)) {
        invalid("invalid message id");
      }
      const value = {
        name: `messages/${id}`,
        sender: text(m.sender),
        text: text(m.text),
        receiveTime: receiveTime.toISOString(),
      };
      let exists = false;
      await vault.update(`inbox/messages/v1/${id}.json`, (old) => {
        if (old) {
          exists = true;
          return null;
        }
        return JSON.stringify(value);
      });
      if (exists) {
        throw new ApiError(409, "message already exists");
      }
      await vault.appendMessage({
        id,
        sender: value.sender,
        text: value.text,
        receivedAt: receiveTime,
      });
      return value;
    },
    listMessages: async (q) => {
      let files: string[] = [];
      try {
        files = await readdir(join(vault.root, "inbox/messages/v1"));
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }
      let rows = await Promise.all(
        files
          .filter((f) => f.endsWith(".json"))
          .map(async (f) => JSON.parse(defined(await vault.read(`inbox/messages/v1/${f}`)))),
      );
      const knownNames = new Set(rows.map((t) => t.name));
      rows.push(...(await legacyMessages(vault)).filter((t) => !knownNames.has(t.name)));
      rows = filter(
        rows.map((t) => ({ ...t, receive_time: t.receiveTime })),
        q.filter,
        ["sender", "receive_time"],
      );
      rows.sort(
        (a, b) => b.receiveTime.localeCompare(a.receiveTime) || a.name.localeCompare(b.name),
      );
      const p = page(rows, q);
      return {
        messages: p.items.map(({ receive_time, ...t }) => t),
        nextPageToken: p.nextPageToken,
      };
    },
    getStream: async (q) => stream(q.name),
    listStreams: async (q) => {
      let names: string[] = [];
      try {
        names = (await readdir(raw.root)).filter((n) => /^[a-z0-9_]{1,40}$/.test(n)).sort();
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== "ENOENT") {
          throw e;
        }
      }
      const rows = [];
      for (const n of names) {
        if (await raw.readColumns(n)) {
          rows.push(await stream(`streams/${n}`));
        }
      }
      const p = page(rows, q);
      return { streams: p.items, nextPageToken: p.nextPageToken };
    },
    mergeSamples: async (q) => {
      if (!/^streams\/[a-z0-9_]{1,40}$/.test(q.stream ?? "")) {
        invalid("invalid stream");
      }
      const day = dateString(q.day ?? {});
      const ts = uploadTimestamps(q, day);
      validateColumns(q.columns, ts.length);
      const upload: Upload = {
        header: ["ts", ...q.columns.map((c: Json) => c.name)],
        samples: ts.map((t: number, i: number) => ({
          ts: t,
          values: q.columns.map((c: Json) =>
            (c.missingRows ?? []).includes(i) ? null : (c.numbers ?? c.texts).values[i],
          ),
        })),
      };
      const name = q.stream.slice(8);
      const result = await raw.store(
        name,
        day,
        upload,
        q.columns.map((c: Json) => ({ name: c.name, type: c.numbers ? "number" : "text" })),
      );
      if (!result.ok) {
        invalid(result.error);
      }
      onSamples(name, day);
      const v = result.ok ? result.value : invalid("store failed");
      return { rows: String(v.rows), added: String(v.added), replaced: String(v.replaced) };
    },
    // biome-ignore lint/complexity/noExcessiveLinesPerFunction: explicit field-by-field mapping of the computed home view to its protobuf contract
    getHome: async (q) => {
      if (q.name !== "home") {
        invalid("name must be home");
      }
      const v = await homeView(home, now());
      return {
        name: "home",
        timeZone: v.timeZone,
        date: dateObject(v.date),
        generateTime: v.generatedAt,
        sentence: v.sentence,
        nextEvent: v.next
          ? {
              title: v.next.title,
              startTime: timeObject(v.next.start),
              detail: v.next.detail,
              minutesUntil: v.next.inMin,
              url: v.next.url ?? "",
            }
          : undefined,
        days: v.days.map((d) => ({
          date: dateObject(d.date),
          events: d.events.map((e) => ({
            title: e.title,
            startTime: timeObject(e.start),
            endTime: timeObject(e.end),
            startMinute: e.startMin,
            endMinute: e.endMin,
            detail: e.detail,
            category: e.category,
            url: e.url ?? "",
          })),
          reminders: d.reminders.map((r) => ({
            task: `tasks/${r.id}`,
            text: r.text,
            time: timeObject(r.time),
            minute: r.minutes,
            done: r.done,
          })),
          datedTasks: d.dated,
        })),
        taskGroups: v.tasks.map((g) => ({
          displayName: g.name,
          tasks: g.tasks.map((t) => ({ task: `tasks/${t.id}`, text: t.text, meta: t.meta })),
        })),
        metrics: v.health.map((m) => ({
          key: m.key,
          displayName: m.name,
          unit: m.unit,
          group: m.group,
          value: m.value ?? undefined,
          rawValue: m.raw ?? undefined,
          delta: m.delta ?? undefined,
          tone: `TONE_${m.tone.toUpperCase()}`,
          yesterday: m.yesterday,
          baseline: m.baseline ?? undefined,
          dailyValues: m.values.map((v) => v ?? 0),
          missingDays: m.values.flatMap((v, i) => (v === null ? [i] : [])),
          lastDate: dateObject(m.lastDate),
        })),
      };
    },
  };
  methods.addTask = async (q) => {
    const spoken = parseWhen(text(q.text), now(), vault.timeZone);
    const task = await defined(methods.createTask)({
      requestId: q.requestId,
      task: {
        description: spoken.description,
        dueDate: spoken.due ? dateObject(spoken.due) : undefined,
        dueTime: spoken.time ? timeObject(spoken.time) : undefined,
      },
    });
    const found = await getTask(task.name);
    return { task: task.name, message: addedMessage(found.task, today()) };
  };
  methods.log = async (q) => {
    const entry = await defined(methods.createJournalEntry)({
      parent: `days/${today()}`,
      journalEntry: { text: q.text },
    });
    return { message: "Logged.", journalEntry: entry.name };
  };
  methods.checkIn = async (q) => {
    const old = await checkin(today());
    const value: Json = { name: old.name };
    if (q.feel) {
      value.feel = Number(q.feel);
    }
    if (q.rpe) {
      value.rpe = Number(q.rpe);
    }
    if (q.tags) {
      value.tags = [
        ...new Set([
          ...(old.tags as string[]),
          ...q.tags
            .split(",")
            .map((s: string) => s.trim().toLowerCase())
            .filter(Boolean),
        ]),
      ];
    }
    await defined(methods.updateCheckin)({ checkin: value });
    return { message: "Check-in recorded." };
  };
  methods.listDue = async (q) => {
    const window = q.window || "today";
    if (!["today", "overdue", "week"].includes(window)) {
      invalid("invalid window");
    }
    const end = Temporal.PlainDate.from(today()).add({ days: 6 }).toString();
    const inWindow: Record<string, (due: string) => boolean> = {
      today: (due) => due === today(),
      overdue: (due) => due < today(),
      week: (due) => due >= today() && due <= end,
    };
    const rows = (await tasks.list()).filter(
      (t) => !t.task.done && t.task.due && defined(inWindow[window])(t.task.due),
    );
    return {
      message: listMessage(
        rows.map((t) => t.task),
        window,
      ),
    };
  };
  methods.completeByText = async (q) => {
    const result = await defined(methods.searchTasks)({ query: q.text });
    const best = result.matches[0];
    if (!best) {
      throw new ApiError(404, "no matching task");
    }
    const completed = await defined(methods.completeTask)({ name: best.task.name });
    const found = await getTask(completed.task.name);
    return { task: completed.task.name, message: completedMessage(found.task, undefined, today()) };
  };
  return methods;
}

function validateColumns(columns: Json[], rowCount: number) {
  const names = new Set<string>();
  for (const c of columns) {
    if (names.has(c.name)) {
      invalid("duplicate column name");
    }
    names.add(c.name);
    validateColumn(c, rowCount);
  }
}
function validateColumn(c: Json, rowCount: number) {
  if (!/^[a-z][a-z0-9_]{0,39}$/.test(c.name) || c.name === "ts") {
    invalid("invalid column name");
  }
  if (Boolean(c.numbers) === Boolean(c.texts)) {
    invalid("exactly one values type required");
  }
  const values = (c.numbers ?? c.texts).values ?? [];
  if (
    values.length !== rowCount ||
    values.some((v: unknown) => !validCell(v, Boolean(c.numbers)))
  ) {
    invalid("invalid column values");
  }
  if ((c.missingRows ?? []).some((i: number) => !Number.isInteger(i) || i < 0 || i >= rowCount)) {
    invalid("invalid missing row");
  }
}
function validCell(value: unknown, numeric: boolean) {
  if (numeric) {
    return typeof value === "number" && Number.isFinite(value);
  }
  return typeof value === "string";
}

function optionalDate(value: string | undefined) {
  return value ? dateObject(value) : undefined;
}
function sortValue(t: Json, key: string) {
  if (key !== "due_time") {
    return t[key] ?? "9999-99-99";
  }
  return t.dueTime ? timeString(t.dueTime) : "99:99";
}

function applyCheckin(frontmatter: Json, t: Json, fields: string[]) {
  for (const field of fields) {
    applyCheckinField(frontmatter, t, field);
  }
}
function applyCheckinField(frontmatter: Json, t: Json, field: string) {
  const key =
    ({ rpe: "effort_rpe", tags: "health_tags" } as Record<string, string>)[field] ?? field;
  const value = t[field];
  if (field === "tags") {
    frontmatter[key] = checkinTags(value);
    return;
  }
  if (value == null) {
    delete frontmatter[key];
    return;
  }
  const [min, max] = field === "feel" ? [1, 5] : [0, 10];
  if (!Number.isInteger(value) || value < defined(min) || value > defined(max)) {
    invalid("invalid check-in score");
  }
  frontmatter[key] = value;
}
function checkinTags(value: unknown): string[] {
  if (value == null) {
    return [];
  }
  if (
    !Array.isArray(value) ||
    value.some((s) => typeof s !== "string" || !/^[a-z0-9_-]+$/.test(s))
  ) {
    invalid("invalid tags");
  }
  return value as string[];
}
function compareTasks(a: Json, b: Json, orders: string[][]) {
  for (const [key, direction] of orders) {
    const cmp = String(sortValue(a, defined(key))).localeCompare(
      String(sortValue(b, defined(key))),
    );
    if (cmp) {
      return cmp * (direction === "desc" ? -1 : 1);
    }
  }
  return a.name.localeCompare(b.name);
}

function uploadTimestamps(q: Json, day: string): number[] {
  const start = Date.parse(day);
  if (
    !(
      Array.isArray(q.timestamps) &&
      q.timestamps.length > 0 &&
      Array.isArray(q.columns) &&
      q.columns.length > 0
    )
  ) {
    invalid("timestamps and columns required");
  }
  const ts = q.timestamps.map(Number);
  if (ts.some((t: number) => !Number.isSafeInteger(t) || t < start || t >= start + 86400000)) {
    invalid("timestamps must fall in UTC day");
  }

  return ts;
}
