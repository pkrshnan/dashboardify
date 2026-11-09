/** REST annotations from proto/dashboardify/v1. Voice methods are RPC-only. */
export interface RestBinding {
  method: string;
  path: string;
  bodyField?: string;
  resource?: { field: string; prefix: string; suffix?: string };
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
  listDevices: { method: "GET", path: "/devices" },
  deleteDevice: {
    method: "DELETE",
    path: "/devices/:id",
    resource: { field: "name", prefix: "devices/" },
  },
};
