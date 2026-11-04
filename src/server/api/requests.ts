/** Protobuf JSON inputs after the transport has checked the generated schema. */
export interface DateParts {
  year?: number;
  month?: number;
  day?: number;
}

export interface TimeParts {
  hours?: number;
  minutes?: number;
  seconds?: number;
  nanos?: number;
}

export interface TaskInput {
  name?: string;
  description?: string;
  dueDate?: DateParts | null;
  dueTime?: TimeParts | null;
  priority?: string;
  recurrence?: string;
  etag?: string;
}

export interface CheckinInput {
  name?: string;
  feel?: number | null;
  rpe?: number | null;
  tags?: string[];
  etag?: string;
}

export interface PageRequest {
  pageSize?: number;
  pageToken?: string;
}

export interface NamedRequest {
  name: string;
}

export interface TaskAction extends NamedRequest {
  etag?: string;
}

export interface ColumnInput {
  name: string;
  numbers?: { values?: number[] };
  texts?: { values?: string[] };
  missingRows?: number[];
}

export interface SampleUpload {
  stream: string;
  day: DateParts;
  timestamps: string[];
  columns: ColumnInput[];
}

export interface ApiRequests {
  getTask: NamedRequest;
  listTasks: PageRequest & { filter?: string; orderBy?: string };
  createTask: { task: TaskInput & { description: string }; requestId?: string };
  updateTask: { task: TaskInput & { name: string }; updateMask?: string };
  deleteTask: TaskAction;
  completeTask: TaskAction;
  reopenTask: TaskAction;
  searchTasks: { query: string; pageSize?: number };
  getDay: NamedRequest;
  getCheckin: NamedRequest;
  updateCheckin: { checkin: CheckinInput & { name: string }; updateMask?: string };
  listJournalEntries: PageRequest & { parent: string };
  createJournalEntry: {
    parent: string;
    journalEntry: { text: string; entryTime?: string };
    requestId?: string;
  };
  createMessage: {
    message: { sender: string; text: string; receiveTime: string };
    messageId?: string;
  };
  listMessages: PageRequest & { filter?: string };
  getStream: NamedRequest;
  listStreams: PageRequest;
  mergeSamples: SampleUpload;
  getHome: NamedRequest;
  addTask: { text: string; requestId?: string };
  log: { text: string };
  checkIn: { feel?: string; rpe?: string; tags?: string };
  listDue: { window?: string };
  completeByText: { text: string };
}
