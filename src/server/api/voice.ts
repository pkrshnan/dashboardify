import { create } from "@bufbuild/protobuf";
import { UpdateCheckinRequestSchema } from "../../gen/dashboardify/v1/day_pb";
import { CreateJournalEntryRequestSchema } from "../../gen/dashboardify/v1/journal_pb";
import { CreateTaskRequestSchema } from "../../gen/dashboardify/v1/task_pb";
import { splitNote } from "../../lists/list-note";
import type { ListStore } from "../../lists/list-store";
import type { TaskStore } from "../../vault/task-store";
import { localDate } from "../../vault/time";
import { parseWhen } from "../../vault/when";
import { findHabit, noHabitSentence, spokenDaysBack, tickedSentence } from "../habit-messages";
import { addedSentence, findList, noListSentence, spokenEntries } from "../list-messages";
import { addedMessage, completedMessage, type DueFilter, listMessage } from "../task-messages";
import { fromDateParts, toDateParts, toTimeParts } from "./date-time";
import type { DaysService } from "./days";
import { ApiError, invalidArgument } from "./errors";
import type { HabitsService } from "./habits";
import type { JournalService } from "./journal";
import type { ListsService } from "./lists";
import { validateMessage } from "./protobuf-validation";
import type { ApiRequests, CheckinInput } from "./requests";
import type { TasksService } from "./tasks";

/** Siri's loose text inputs are translated into the resource services here. */
export class VoiceService {
  constructor(
    private readonly tasks: TasksService,
    private readonly days: DaysService,
    private readonly journal: JournalService,
    private readonly store: TaskStore,
    private readonly timeZone: string,
    private readonly now: () => Date,
    private readonly lists: { service: ListsService; store: ListStore },
    private readonly habits: HabitsService,
  ) {}

  private today() {
    return localDate(this.now(), this.timeZone);
  }

  addTask = async (request: ApiRequests["addTask"]) => {
    const spoken = parseWhen(request.text, this.now(), this.timeZone);
    const taskRequest = {
      requestId: request.requestId,
      task: {
        description: spoken.description,
        dueDate: spoken.due ? toDateParts(spoken.due) : undefined,
        dueTime: spoken.time ? toTimeParts(spoken.time) : undefined,
      },
    };
    validateMessage(CreateTaskRequestSchema, create(CreateTaskRequestSchema, taskRequest));
    const task = await this.tasks.createTask(taskRequest);
    const stored = await this.tasks.findTask(task.name);
    return { task: task.name, message: addedMessage(stored.task, this.today()) };
  };

  log = async (request: ApiRequests["log"]) => {
    const entryRequest = {
      parent: `days/${this.today()}`,
      journalEntry: { text: request.text },
    };
    validateMessage(
      CreateJournalEntryRequestSchema,
      create(CreateJournalEntryRequestSchema, entryRequest),
    );
    const entry = await this.journal.createJournalEntry(entryRequest);
    return { message: "Logged.", journalEntry: entry.name };
  };

  checkIn = async (request: ApiRequests["checkIn"]) => {
    const current = await this.days.getCheckin({ name: `days/${this.today()}/checkin` });
    const checkin: CheckinInput & { name: string } = { name: current.name };
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
    validateMessage(
      UpdateCheckinRequestSchema,
      create(UpdateCheckinRequestSchema, {
        checkin: {
          name: checkin.name,
          feel: checkin.feel ?? undefined,
          rpe: checkin.rpe ?? undefined,
          tags: checkin.tags,
        },
      }),
    );
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

  addToList = async (request: ApiRequests["addToList"]) => {
    const all = await this.lists.store.lists();
    const list = findList(request.list, all);
    if (!list) {
      throw new ApiError(404, noListSentence(request.list, all), "not_found");
    }
    const items = (await this.lists.store.get(list.slug))?.sections.flatMap((s) => s.items) ?? [];
    const open = new Set(items.filter((i) => !i.done).map((i) => i.text.toLowerCase()));
    const names = spokenEntries(
      request.text,
      items.map((i) => i.text),
    ).map((e) => splitNote(e).text);
    if (names.length === 0) {
      invalidArgument("nothing to add");
    }
    await this.lists.service.addListItems({ parent: `lists/${list.slug}`, texts: names });
    const already = names.filter((name) => open.has(name.toLowerCase()));
    const added = names.filter((name) => !open.has(name.toLowerCase()));
    return { list: `lists/${list.slug}`, message: addedSentence(list.title, added, already) };
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

  tickHabit = async (request: ApiRequests["tickHabit"]) => {
    const { habits } = await this.habits.listHabits({});
    const habit = findHabit(request.text, habits);
    if (!habit) {
      throw new ApiError(404, noHabitSentence(request.text, habits), "not_found");
    }
    const daysBack = spokenDaysBack(request.text);
    const today = Temporal.PlainDate.from(fromDateParts(habit.progress.day));
    const day = toDateParts(today.subtract({ days: daysBack }).toString());
    const ticked = await this.habits.markHabit({ name: habit.name, day, done: true });
    const weekly =
      ticked.schedule.kind === "KIND_WEEKLY" ? ticked.schedule.timesPerWeek : undefined;
    return {
      habit: ticked.name,
      message: tickedSentence(ticked.displayName, ticked.progress, weekly, daysBack),
    };
  };
}
