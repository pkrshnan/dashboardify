import type { DescService } from "@bufbuild/protobuf";
import type { CalendarAccounts } from "../../calendar/accounts";
import type { EventCache } from "../../calendar/cache";
import type { CalendarSync } from "../../calendar/sync";
import { ActivityService as ActivitySchema } from "../../gen/dashboardify/v1/activity_pb";
import { CalendarAccountService as CalendarAccountSchema } from "../../gen/dashboardify/v1/calendar_account_pb";
import { CaptureService as CaptureSchema } from "../../gen/dashboardify/v1/capture_pb";
import { DayService as DaySchema } from "../../gen/dashboardify/v1/day_pb";
import { DeviceService as DeviceSchema } from "../../gen/dashboardify/v1/device_pb";
import { EventService as EventSchema } from "../../gen/dashboardify/v1/event_pb";
import { HomeService as HomeSchema } from "../../gen/dashboardify/v1/home_pb";
import { JournalService as JournalSchema } from "../../gen/dashboardify/v1/journal_pb";
import { ListService as ListSchema } from "../../gen/dashboardify/v1/list_pb";
import { MessageService as MessageSchema } from "../../gen/dashboardify/v1/message_pb";
import { PlaceService as PlaceSchema } from "../../gen/dashboardify/v1/place_pb";
import { SampleService as SampleSchema } from "../../gen/dashboardify/v1/sample_pb";
import { SettingsService as SettingsSchema } from "../../gen/dashboardify/v1/settings_pb";
import { TaskService as TaskSchema } from "../../gen/dashboardify/v1/task_pb";
import { VoiceService as VoiceSchema } from "../../gen/dashboardify/v1/voice_pb";
import type { RawStore } from "../../health/raw-store";
import type { HomeDeps } from "../../home/home";
import { ListStore } from "../../lists/list-store";
import type { PlaceSearch } from "../../places/place";
import type { GeneralSettings } from "../../settings/core";
import type { DeviceStore } from "../../settings/devices";
import type { TaskStore } from "../../vault/task-store";
import type { Vault } from "../../vault/vault";
import { type ActivityDeps, ActivityService } from "../api/activity";
import {
  CalendarAccountService,
  type ConnectCalDav,
  connectICloud,
} from "../api/calendar-accounts";
import { CaptureService } from "../api/capture";
import { DaysService } from "../api/days";
import { DevicesService } from "../api/devices";
import { failedPrecondition } from "../api/errors";
import { EventsService } from "../api/events";
import { HomeService } from "../api/home";
import { JournalService } from "../api/journal";
import { ListsService } from "../api/lists";
import { MessagesService } from "../api/messages";
import { PlacesService } from "../api/places";
import { SamplesService } from "../api/samples";
import { SettingsService } from "../api/settings";
import { TasksService } from "../api/tasks";
import { VoiceService } from "../api/voice";

/** settings.db, for the Settings and Device services. Without it they aren't served. */
export interface SettingsDeps {
  general: GeneralSettings;
  devices: DeviceStore;
  /**
   * Calendar accounts, and how to reach their server (the fake one in tests). With the cache
   * and the sync loop, events can be read and written too.
   */
  calendars?: {
    accounts: CalendarAccounts;
    connect?: ConnectCalDav;
    cache?: EventCache;
    sync?: Pick<CalendarSync, "syncCalendar">;
    /** How calendar links are fetched; tests pass a fake server. */
    feedFetch?: (request: Request) => Promise<Response>;
  };
  /** Place search for event locations (Photon; a fake in tests). Without it, it isn't served. */
  places?: PlaceSearch;
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
  const listStore = new ListStore(vault);
  const listsService = new ListsService(listStore);
  const voiceService = new VoiceService(
    taskService,
    dayService,
    journalService,
    tasks,
    vault.timeZone,
    now,
    { service: listsService, store: listStore },
  );
  const events = eventService(settings?.calendars, now, vault.timeZone);
  const captureService = new CaptureService(
    {
      createTask: taskService.createTask,
      createEvent: events
        ? events.createEvent
        : () => failedPrecondition("Connect a calendar in Settings to add events."),
    },
    home.calendar,
    vault.timeZone,
    now,
    findPlaces(settings),
  );
  return [
    { schema: TaskSchema, implementation: taskService },
    { schema: DaySchema, implementation: dayService },
    { schema: JournalSchema, implementation: journalService },
    { schema: MessageSchema, implementation: new MessagesService(vault) },
    { schema: ListSchema, implementation: listsService },
    { schema: SampleSchema, implementation: new SamplesService(raw, onSamples) },
    { schema: HomeSchema, implementation: new HomeService(home, now) },
    { schema: ActivitySchema, implementation: new ActivityService(activity) },
    { schema: VoiceSchema, implementation: voiceService },
    { schema: CaptureSchema, implementation: captureService },
    ...(events ? [{ schema: EventSchema, implementation: events }] : []),
    ...(settings ? settingsServices(settings, now) : []),
  ];
}

function settingsServices(settings: SettingsDeps, now: () => Date): ServiceRegistration[] {
  const { general, devices, calendars, places } = settings;
  return [
    { schema: SettingsSchema, implementation: new SettingsService(general) },
    { schema: DeviceSchema, implementation: new DevicesService(devices, now) },
    ...(places
      ? [{ schema: PlaceSchema, implementation: new PlacesService(places, general) }]
      : []),
    ...(calendars
      ? [
          {
            schema: CalendarAccountSchema,
            implementation: new CalendarAccountService(
              calendars.accounts,
              calendars.connect ?? connectICloud,
              calendars.feedFetch,
              now,
            ),
          },
        ]
      : []),
  ];
}

/** Place search near Settings' places_near, for the capture box's "at …". */
function findPlaces(settings: SettingsDeps | undefined) {
  const { places, general } = settings ?? {};
  return places && general
    ? (query: string) => places.search(query, general.get().placesNear)
    : undefined;
}

/** Events need the cache and the sync loop as well as the accounts. */
function eventService(
  calendars: SettingsDeps["calendars"],
  now: () => Date,
  timeZone: string,
): EventsService | undefined {
  if (!(calendars?.cache && calendars.sync)) {
    return undefined;
  }
  const { accounts, cache, sync } = calendars;
  const connect = calendars.connect ?? connectICloud;
  return new EventsService({ accounts, cache, sync, connect, timeZone, now });
}
