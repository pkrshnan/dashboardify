import type { DescService } from "@bufbuild/protobuf";
import { DayService as DaySchema } from "../../gen/dashboardify/v1/day_pb";
import { DeviceService as DeviceSchema } from "../../gen/dashboardify/v1/device_pb";
import { HomeService as HomeSchema } from "../../gen/dashboardify/v1/home_pb";
import { JournalService as JournalSchema } from "../../gen/dashboardify/v1/journal_pb";
import { MessageService as MessageSchema } from "../../gen/dashboardify/v1/message_pb";
import { SampleService as SampleSchema } from "../../gen/dashboardify/v1/sample_pb";
import { SettingsService as SettingsSchema } from "../../gen/dashboardify/v1/settings_pb";
import { TaskService as TaskSchema } from "../../gen/dashboardify/v1/task_pb";
import { VoiceService as VoiceSchema } from "../../gen/dashboardify/v1/voice_pb";
import type { RawStore } from "../../health/raw-store";
import type { HomeDeps } from "../../home/home";
import type { GeneralSettings, SettingsChange } from "../../settings/core";
import type { DeviceStore } from "../../settings/devices";
import type { TaskStore } from "../../vault/task-store";
import type { Vault } from "../../vault/vault";
import { DaysService } from "../api/days";
import { DevicesService } from "../api/devices";
import { HomeService } from "../api/home";
import { JournalService } from "../api/journal";
import { MessagesService } from "../api/messages";
import { SamplesService } from "../api/samples";
import { SettingsService } from "../api/settings";
import { TasksService } from "../api/tasks";
import { VoiceService } from "../api/voice";

/** settings.db, for the Settings and Device services. Without it they aren't served. */
export interface SettingsDeps {
  general: GeneralSettings;
  devices: DeviceStore;
  /** The environment's values and the variables that set them, which win over Settings. */
  envChange: SettingsChange;
  envNames: string[];
}

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
  settings?: SettingsDeps,
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
    ...(settings ? settingsServices(settings, now) : []),
  ];
}

function settingsServices(settings: SettingsDeps, now: () => Date): ServiceRegistration[] {
  const { general, devices, envChange, envNames } = settings;
  return [
    { schema: SettingsSchema, implementation: new SettingsService(general, envChange, envNames) },
    { schema: DeviceSchema, implementation: new DevicesService(devices, now) },
  ];
}
