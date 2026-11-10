/** REST annotations from proto/dashboardify/v1. Voice methods are RPC-only. */
export interface RestBinding {
  method: string;
  path: string;
  bodyField?: string;
  /** How to rebuild the resource name from the path; `nested` adds "/<nested>/:child". */
  resource?: { field: string; prefix: string; suffix?: string; nested?: string };
}

export const restBindings: Record<string, RestBinding> = {
  getTask: { method: "GET", path: "/tasks/:id", resource: { field: "name", prefix: "tasks/" } },
  listTasks: { method: "GET", path: "/tasks" },
  createTask: { method: "POST", path: "/tasks", bodyField: "task" },
  updateTask: {
    method: "PATCH",
    path: "/tasks/:id",
    bodyField: "task",
    resource: { field: "task.name", prefix: "tasks/" },
  },
  deleteTask: {
    method: "DELETE",
    path: "/tasks/:id",
    resource: { field: "name", prefix: "tasks/" },
  },
  completeTask: {
    method: "POST",
    path: "/tasks/:id{[a-zA-Z0-9_-]+:complete}",
    resource: { field: "name", prefix: "tasks/" },
  },
  reopenTask: {
    method: "POST",
    path: "/tasks/:id{[a-zA-Z0-9_-]+:reopen}",
    resource: { field: "name", prefix: "tasks/" },
  },
  searchTasks: { method: "GET", path: "/tasks:search" },
  searchPlaces: { method: "GET", path: "/places:search" },
  getDay: { method: "GET", path: "/days/:day", resource: { field: "name", prefix: "days/" } },
  getCheckin: {
    method: "GET",
    path: "/days/:day/checkin",
    resource: { field: "name", prefix: "days/", suffix: "/checkin" },
  },
  updateCheckin: {
    method: "PATCH",
    path: "/days/:day/checkin",
    bodyField: "checkin",
    resource: { field: "checkin.name", prefix: "days/", suffix: "/checkin" },
  },
  createJournalEntry: {
    method: "POST",
    path: "/days/:day/journalEntries",
    bodyField: "journalEntry",
    resource: { field: "parent", prefix: "days/" },
  },
  listJournalEntries: {
    method: "GET",
    path: "/days/:day/journalEntries",
    resource: { field: "parent", prefix: "days/" },
  },
  createMessage: { method: "POST", path: "/messages", bodyField: "message" },
  listMessages: { method: "GET", path: "/messages" },
  getStream: {
    method: "GET",
    path: "/streams/:id",
    resource: { field: "name", prefix: "streams/" },
  },
  listStreams: { method: "GET", path: "/streams" },
  mergeSamples: {
    method: "POST",
    path: "/streams/:id{[a-zA-Z0-9_-]+:mergeSamples}",
    resource: { field: "stream", prefix: "streams/" },
  },
  getHome: { method: "GET", path: "/home", resource: { field: "name", prefix: "home" } },
  getSettings: {
    method: "GET",
    path: "/settings",
    resource: { field: "name", prefix: "settings" },
  },
  updateSettings: {
    method: "PATCH",
    path: "/settings",
    bodyField: "settings",
    resource: { field: "settings.name", prefix: "settings" },
  },
  createDevice: { method: "POST", path: "/devices", bodyField: "device" },
  listCalendarAccounts: { method: "GET", path: "/calendarAccounts" },
  getCalendarAccount: {
    method: "GET",
    path: "/calendarAccounts/:id",
    resource: { field: "name", prefix: "calendarAccounts/" },
  },
  createCalendarAccount: {
    method: "POST",
    path: "/calendarAccounts",
    bodyField: "calendarAccount",
  },
  updateCalendarAccount: {
    method: "PATCH",
    path: "/calendarAccounts/:id",
    bodyField: "calendarAccount",
    resource: { field: "calendarAccount.name", prefix: "calendarAccounts/" },
  },
  deleteCalendarAccount: {
    method: "DELETE",
    path: "/calendarAccounts/:id",
    resource: { field: "name", prefix: "calendarAccounts/" },
  },
  syncCalendarAccount: {
    method: "POST",
    path: "/calendarAccounts/:id{[a-z0-9-]+:sync}",
    resource: { field: "name", prefix: "calendarAccounts/" },
  },
  listCalendars: {
    method: "GET",
    path: "/calendarAccounts/:id/calendars",
    resource: { field: "parent", prefix: "calendarAccounts/" },
  },
  updateCalendar: {
    method: "PATCH",
    path: "/calendarAccounts/:id/calendars/:child",
    bodyField: "calendar",
    resource: { field: "calendar.name", prefix: "calendarAccounts/", nested: "calendars" },
  },
  parseCapture: { method: "POST", path: "/captures:parse" },
  capture: { method: "POST", path: "/captures" },
  getEvent: { method: "GET", path: "/events/:id", resource: { field: "name", prefix: "events/" } },
  listEvents: { method: "GET", path: "/events" },
  createEvent: { method: "POST", path: "/events", bodyField: "event" },
  updateEvent: {
    method: "PATCH",
    path: "/events/:id",
    bodyField: "event",
    resource: { field: "event.name", prefix: "events/" },
  },
  deleteEvent: {
    method: "DELETE",
    path: "/events/:id",
    resource: { field: "name", prefix: "events/" },
  },
  getCalendarSettings: {
    method: "GET",
    path: "/calendarSettings",
    resource: { field: "name", prefix: "calendarSettings" },
  },
  updateCalendarSettings: {
    method: "PATCH",
    path: "/calendarSettings",
    bodyField: "calendarSettings",
    resource: { field: "calendarSettings.name", prefix: "calendarSettings" },
  },
  listDevices: { method: "GET", path: "/devices" },
  deleteDevice: {
    method: "DELETE",
    path: "/devices/:id",
    resource: { field: "name", prefix: "devices/" },
  },
  listActivityDays: { method: "GET", path: "/activityDays" },
  getWorkout: {
    method: "GET",
    path: "/days/:day/workouts/:workout",
    resource: { field: "name", prefix: "days/" },
  },
  reviewWorkout: {
    method: "POST",
    path: "/days/:day/workouts/:workout{[0-9]{4}:review}",
    resource: { field: "name", prefix: "days/" },
  },
  getNight: {
    method: "GET",
    path: "/days/:day/night",
    resource: { field: "name", prefix: "days/", suffix: "/night" },
  },
};
