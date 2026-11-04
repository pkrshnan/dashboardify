import type { DescService } from "@bufbuild/protobuf";
import { DayService as DaySchema } from "../../gen/dashboardify/v1/day_pb";
import { HomeService as HomeSchema } from "../../gen/dashboardify/v1/home_pb";
import { JournalService as JournalSchema } from "../../gen/dashboardify/v1/journal_pb";
import { MessageService as MessageSchema } from "../../gen/dashboardify/v1/message_pb";
import { SampleService as SampleSchema } from "../../gen/dashboardify/v1/sample_pb";
import { TaskService as TaskSchema } from "../../gen/dashboardify/v1/task_pb";
import { VoiceService as VoiceSchema } from "../../gen/dashboardify/v1/voice_pb";
import type { RawStore } from "../../health/raw-store";
import type { HomeDeps } from "../../home/home";
import type { TaskStore } from "../../vault/task-store";
import type { Vault } from "../../vault/vault";
import { DaysService } from "../api/days";
import { HomeService } from "../api/home";
import { JournalService } from "../api/journal";
import { MessagesService } from "../api/messages";
import { SamplesService } from "../api/samples";
import { TasksService } from "../api/tasks";
import { VoiceService } from "../api/voice";

export interface ServiceRegistration {
  schema: DescService;
  implementation: object;
}

/** Each transport serves the same service instances and therefore the same stores. */
export function v1Services(
  vault: Vault,
  tasks: TaskStore,
  raw: RawStore,
  home: HomeDeps,
  now = () => new Date(),
  onSamples: (stream: string, day: string) => void = () => undefined,
): ServiceRegistration[] {
  const taskService = new TasksService(tasks, vault, now);
  const dayService = new DaysService(vault);
  const journalService = new JournalService(vault, now);
  const voiceService = new VoiceService(
    taskService,
    dayService,
    journalService,
    tasks,
    vault.timeZone,
    now,
  );
  return [
    { schema: TaskSchema, implementation: taskService },
    { schema: DaySchema, implementation: dayService },
    { schema: JournalSchema, implementation: journalService },
    { schema: MessageSchema, implementation: new MessagesService(vault) },
    { schema: SampleSchema, implementation: new SamplesService(raw, onSamples) },
    { schema: HomeSchema, implementation: new HomeService(home, now) },
    { schema: VoiceSchema, implementation: voiceService },
  ];
}
