import { randomUUID } from "node:crypto";
import Fuse from "fuse.js";
import { defined } from "../../defined";
import type { FoundTask, TaskStore } from "../../vault/task-store";
import type { Priority, Task } from "../../vault/tasks";
import { localDate } from "../../vault/time";
import type { Vault } from "../../vault/vault";
import { fromDateParts, fromTimeParts, toDateParts, toTimeParts } from "./date-time";
import { ApiError, invalidArgument, requireText } from "./errors";
import { filterItems } from "./filter";
import { paginate } from "./pagination";
import type { ApiRequests, TaskInput } from "./requests";
import { requestedFields } from "./update-mask";
/** Reads and edits Obsidian task lines through TaskStore. */
export class TasksService {
  constructor(
    private readonly tasks: TaskStore,
    private readonly vault: Vault,
    private readonly now: () => Date,
  ) {}

  private readonly today = () => localDate(this.now(), this.vault.timeZone);

  private readonly taskView = async (found: FoundTask) => {
    const { task, ref, path } = found;
    return {
      name: `tasks/${ref}`,
      description: task.description,
      state: task.done ? "STATE_DONE" : "STATE_OPEN",
      dueDate: optionalDate(task.due),
      dueTime: task.time ? toTimeParts(task.time) : undefined,
      priority: task.priority ? `PRIORITY_${task.priority.toUpperCase()}` : "PRIORITY_UNSPECIFIED",
      recurrence: task.recurrence ?? "",
      createDate: optionalDate(task.created),
      completeDate: optionalDate(task.completed),
      path,
      etag: await this.tasks.etag(found),
    };
  };

  readonly findTask = async (name: string) => {
    const task = (await this.tasks.list()).find((task) => `tasks/${task.ref}` === name);
    if (!task) {
      throw new ApiError(404, "task not found");
    }
    return task;
  };

  getTask = async (request: ApiRequests["getTask"]) =>
    this.taskView(await this.findTask(request.name));

  listTasks = async (request: ApiRequests["listTasks"]) => {
    const taskViews = await Promise.all((await this.tasks.list()).map(this.taskView));
    let rows = taskViews.map((task) => ({
      ...task,
      due_date: task.dueDate ? fromDateParts(task.dueDate) : undefined,
    }));
    rows = filterItems(rows, request.filter, ["state", "due_date"]);
    const orders = (request.orderBy || "due_date, due_time, description")
      .split(",")
      .map((order: string) => order.trim().split(/\s+/));
    if (
      orders.some(
        ([field, direction]: string[]) =>
          !["due_date", "due_time", "description"].includes(defined(field)) ||
          (direction && direction !== "desc" && direction !== "asc"),
      )
    ) {
      invalidArgument("invalid order_by");
    }
    rows.sort((left, right) => compareTasks(left, right, orders));
    const resultPage = paginate(rows, request);
    return {
      tasks: resultPage.items.map(({ due_date, ...task }) => task),
      nextPageToken: resultPage.nextPageToken,
    };
  };

  createTask = async (request: ApiRequests["createTask"]) => {
    const task = request.task ?? {};
    const result = await this.tasks.add(
      {
        key: request.requestId || randomUUID(),
        description: requireText(task.description).trim(),
        due: task.dueDate ? fromDateParts(task.dueDate) : undefined,
        time: task.dueTime ? fromTimeParts(task.dueTime) : undefined,
        priority: parsePriority(task.priority),
        recurrence: task.recurrence,
      },
      this.today(),
    );
    return this.taskView(result.task);
  };

  updateTask = async (request: ApiRequests["updateTask"]) => {
    const task = request.task;
    await this.findTask(task?.name ?? "");
    const fields = requestedFields(request, task, [
      "description",
      "dueDate",
      "dueTime",
      "priority",
      "recurrence",
    ]);
    const changes = parseTaskChanges(task, fields);
    const result = await this.tasks.edit((task.name ?? "").slice(6), task.etag, (current) => ({
      ...current,
      ...changes,
    }));
    return this.taskView(defined(result));
  };

  deleteTask = async (request: ApiRequests["deleteTask"]) => {
    const task = await this.findTask(request.name);
    await this.tasks.edit(task.ref, request.etag, () => null);
    return {};
  };

  completeTask = async (request: ApiRequests["completeTask"]) => {
    const task = await this.findTask(request.name);
    const result = await this.tasks.complete(task.ref, this.today(), request.etag);
    if (result.status === "not_found") {
      throw new ApiError(404, "task not found");
    }
    return {
      task: await this.taskView(result.task),
      nextTask:
        result.status === "completed" && result.next
          ? await this.taskView({
              ref: defined(result.next.id),
              path: task.path,
              task: result.next,
            })
          : undefined,
    };
  };

  reopenTask = async (request: ApiRequests["reopenTask"]) => {
    const task = await this.findTask(request.name);
    return this.taskView(
      defined(
        await this.tasks.edit(task.ref, request.etag, (task) => ({
          ...task,
          done: false,
          completed: undefined,
        })),
      ),
    );
  };

  searchTasks = async (request: ApiRequests["searchTasks"]) => {
    const fuse = new Fuse(
      (await this.tasks.list()).filter((task) => !task.task.done),
      { keys: ["task.description"], includeScore: true },
    );
    return {
      matches: await Promise.all(
        fuse
          .search(requireText(request.query), {
            limit: Math.min(Number(request.pageSize || 5), 500),
          })
          .map(async (match) => ({
            task: await this.taskView(match.item),
            score: match.score ?? 1,
          })),
      ),
    };
  };
}

function optionalDate(value: string | undefined) {
  return value ? toDateParts(value) : undefined;
}

function sortValue(task: TaskView, key: string) {
  if (key !== "due_time") {
    if (key === "description") {
      return task.description;
    }
    return task.dueDate ? fromDateParts(task.dueDate) : "9999-99-99";
  }
  return task.dueTime ? fromTimeParts(task.dueTime) : "99:99";
}

function compareTasks(left: TaskView, right: TaskView, orders: string[][]) {
  for (const [key, direction] of orders) {
    const cmp = String(sortValue(left, defined(key))).localeCompare(
      String(sortValue(right, defined(key))),
    );
    if (cmp) {
      return cmp * (direction === "desc" ? -1 : 1);
    }
  }
  return left.name.localeCompare(right.name);
}
type TaskView = Awaited<ReturnType<TasksService["getTask"]>>;

function parsePriority(value: string | undefined): Priority | undefined {
  if (!value || value === "PRIORITY_UNSPECIFIED") {
    return undefined;
  }
  const priority = value.replace("PRIORITY_", "").toLowerCase();
  if (!["lowest", "low", "medium", "high", "highest"].includes(priority)) {
    invalidArgument("invalid priority");
  }
  return priority as Priority;
}

function parseTaskChanges(task: TaskInput, fields: string[]): Partial<Task> {
  const changes: Partial<Task> = {};
  if (fields.includes("description")) {
    changes.description = requireText(task.description);
  }
  if (fields.includes("dueDate")) {
    changes.due = task.dueDate ? fromDateParts(task.dueDate) : undefined;
  }
  if (fields.includes("dueTime")) {
    changes.time = task.dueTime ? fromTimeParts(task.dueTime) : undefined;
  }
  if (fields.includes("priority")) {
    changes.priority = parsePriority(task.priority);
  }
  if (fields.includes("recurrence")) {
    changes.recurrence = task.recurrence || undefined;
  }
  return changes;
}
