import type { DescService } from "@bufbuild/protobuf";
import type { CalendarAccounts } from "../../calendar/accounts";
import type { EventCache } from "../../calendar/cache";
import type { CalendarSync } from "../../calendar/sync";
import { ActivityService as ActivitySchema } from "../../gen/dashboardify/v1/activity_pb";
import { CalendarAccountService as CalendarAccountSchema } from "../../gen/dashboardify/v1/calendar_account_pb";
import { DayService as DaySchema } from "../../gen/dashboardify/v1/day_pb";
import { DeviceService as DeviceSchema } from "../../gen/dashboardify/v1/device_pb";
import { EventService as EventSchema } from "../../gen/dashboardify/v1/event_pb";
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
import { type ActivityDeps, ActivityService } from "../api/activity";
import {
  CalendarAccountService,
  type ConnectCalDav,
  connectICloud,
} from "../api/calendar-accounts";
import { DaysService } from "../api/days";
import { DevicesService } from "../api/devices";
import { EventsService } from "../api/events";
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
  /**
   * Calendar accounts, and how to reach their server (the fake one in tests). With the cache
   * and the sync loop, events can be read and written too.
   */
  calendars?: {
    accounts: CalendarAccounts;
    connect?: ConnectCalDav;
    cache?: EventCache;
    sync?: Pick<CalendarSync, "syncCalendar">;
  };
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
  activity: ActivityDeps,
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
    { schema: ActivitySchema, implementation: new ActivityService(activity) },
    { schema: VoiceSchema, implementation: voiceService },
    ...(settings ? settingsServices(settings, now, vault.timeZone) : []),
  ];
}

function settingsServices(
  settings: SettingsDeps,
  now: () => Date,
  timeZone: string,
): ServiceRegistration[] {
  const { general, devices, envChange, envNames, calendars } = settings;
  return [
    { schema: SettingsSchema, implementation: new SettingsService(general, envChange, envNames) },
    { schema: DeviceSchema, implementation: new DevicesService(devices, now) },
    ...(calendars ? calendarServices(calendars, now, timeZone) : []),
  ];
}

function calendarServices(
  calendars: NonNullable<SettingsDeps["calendars"]>,
  now: () => Date,
  timeZone: string,
): ServiceRegistration[] {
  const { accounts, cache, sync } = calendars;
  const connect = calendars.connect ?? connectICloud;
  return [
    {
      schema: CalendarAccountSchema,
      implementation: new CalendarAccountService(accounts, connect),
    },
    ...(cache && sync
      ? [
          {
            schema: EventSchema,
            implementation: new EventsService({ accounts, cache, sync, connect, timeZone, now }),
          },
        ]
      : []),
  ];
}
