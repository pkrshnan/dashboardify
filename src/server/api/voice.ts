import type { TaskStore } from "../../vault/task-store";
import { localDate } from "../../vault/time";
import { parseWhen } from "../../vault/when";
import { addedMessage, completedMessage, type DueFilter, listMessage } from "../task-messages";
import { toDateParts, toTimeParts } from "./date-time";
import type { DaysService } from "./days";
import { ApiError, invalidArgument, requireText } from "./errors";
import type { JournalService } from "./journal";
import type { ApiRequests, CheckinInput } from "./requests";
import type { TasksService } from "./tasks";

/** Siri's loose requireText inputs are translated into the resource services here. */
export class VoiceService {
  constructor(
    private readonly tasks: TasksService,
    private readonly days: DaysService,
    private readonly journal: JournalService,
    private readonly store: TaskStore,
    private readonly timeZone: string,
    private readonly now: () => Date,
  ) {}

  private today() {
    return localDate(this.now(), this.timeZone);
  }

  addTask = async (request: ApiRequests["addTask"]) => {
    const spoken = parseWhen(requireText(request.text), this.now(), this.timeZone);
    const task = await this.tasks.createTask({
      requestId: request.requestId,
      task: {
        description: spoken.description,
        dueDate: spoken.due ? toDateParts(spoken.due) : undefined,
        dueTime: spoken.time ? toTimeParts(spoken.time) : undefined,
      },
    });
    const stored = await this.tasks.findTask(task.name);
    return { task: task.name, message: addedMessage(stored.task, this.today()) };
  };

  log = async (request: ApiRequests["log"]) => {
    const entry = await this.journal.createJournalEntry({
      parent: `days/${this.today()}`,
      journalEntry: { text: request.text },
    });
    return { message: "Logged.", journalEntry: entry.name };
  };

  checkIn = async (request: ApiRequests["checkIn"]) => {
    const current = await this.days.getCheckin({ name: `days/${this.today()}/checkin` });
    const checkin: CheckinInput = { name: current.name };
    if (request.feel) {
      checkin.feel = Number(request.feel);
    }
    if (request.rpe) {
      checkin.rpe = Number(request.rpe);
    }
    if (request.tags) {
      const spokenTags = request.tags
        .split(",")
        .map((tag) => tag.trim().toLowerCase())
        .filter(Boolean);
      checkin.tags = [...new Set([...current.tags, ...spokenTags])];
    }
    await this.days.updateCheckin({ checkin });
    return { message: "Check-in recorded." };
  };

  listDue = async (request: ApiRequests["listDue"]) => {
    const window = request.window || "today";
    if (!["today", "overdue", "week"].includes(window)) {
      invalidArgument("invalid window");
    }
    const today = this.today();
    const weekEnd = Temporal.PlainDate.from(today).add({ days: 6 }).toString();
    const matches: Record<string, (due: string) => boolean> = {
      today: (due) => due === today,
      overdue: (due) => due < today,
      week: (due) => due >= today && due <= weekEnd,
    };
    const inWindow = matches[window];
    if (!inWindow) {
      throw new ApiError(400, "invalid window");
    }
    const tasks = (await this.store.list()).filter(
      ({ task }) => !task.done && task.due && inWindow(task.due),
    );
    return {
      message: listMessage(
        tasks.map((found) => found.task),
        window as DueFilter,
      ),
    };
  };

  completeByText = async (request: ApiRequests["completeByText"]) => {
    const { matches } = await this.tasks.searchTasks({ query: request.text });
    const best = matches[0];
    if (!best) {
      throw new ApiError(404, "no matching task");
    }
    const completed = await this.tasks.completeTask({ name: best.task.name });
    const stored = await this.tasks.findTask(completed.task.name);
    return {
      task: completed.task.name,
      message: completedMessage(stored.task, undefined, this.today()),
    };
  };
}
