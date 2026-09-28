export type CaptureKind = 'reminder' | 'event' | 'note' | 'fact' | 'activity' | 'pending';

export interface CaptureHighlight {
  start: number;
  end: number;
  kind: 'intent' | 'time' | 'date' | 'place';
  label: string;
}

export interface CaptureProposal {
  kind: Exclude<CaptureKind, 'pending'>;
  title: string;
  subject?: string;
  scheduled_at?: string;
  scheduled_end_at?: string;
  scheduled_date?: string;
  scheduled_timezone?: string;
  occurred_date?: string;
  all_day?: boolean;
  display_when?: string;
  place?: string;
  needs_review: boolean;
  highlights: CaptureHighlight[];
}

export interface CaptureRecord {
  id: string;
  raw_text: string;
  kind: CaptureKind;
  title: string;
  subject?: string;
  scheduled_at?: string;
  scheduled_end_at?: string;
  scheduled_date?: string;
  scheduled_timezone?: string;
  all_day?: boolean;
  occurred_date?: string;
  display_when?: string;
  place?: string;
  state: 'pending' | 'resolved';
  inbox_state: 'open' | 'filed';
  captured_at: string;
}

export interface CaptureClassification {
  kind: Exclude<CaptureKind, 'pending'>;
  title: string;
  subject?: string;
  scheduled_at?: string;
  scheduled_end_at?: string;
  scheduled_date?: string;
  occurred_date?: string;
  all_day?: boolean;
  place?: string;
  classified_at: string;
}

export interface CaptureDetail {
  capture: CaptureRecord;
  history: CaptureClassification[];
}

export interface ClassificationInput {
  kind: Exclude<CaptureKind, 'pending'>;
  title: string;
  subject?: string;
  scheduled_at?: string;
  scheduled_end_at?: string;
  scheduled_date?: string;
  occurred_date?: string;
  scheduled_timezone?: string;
  all_day?: boolean;
  place?: string;
}

export interface TaskRecord {
  id: string;
  capture_id: string;
  title: string;
  due_at?: string;
  due_date?: string;
  reminder_at?: string;
  all_day?: boolean;
  timezone: string;
  place?: string;
  status: 'open' | 'completed' | 'archived';
  completed_at?: string;
  deferred_until_date?: string;
  created_at: string;
  updated_at: string;
  overdue: boolean;
}

export interface EventRecord {
  id: string;
  capture_id?: string;
  title: string;
  start_at?: string;
  end_at?: string;
  start_date?: string;
  end_date?: string;
  all_day?: boolean;
  timezone: string;
  place?: string;
  status: 'confirmed' | 'tentative' | 'cancelled';
  created_at?: string;
  updated_at?: string;
  provider?: 'apple_calendar';
  read_only?: boolean;
  remote_path?: string;
}

export interface TodayView {
  date: string;
  timezone: string;
  tasks: TaskRecord[];
  events: EventRecord[];
}

export type TaskUpdate = Pick<
  TaskRecord,
  'title' | 'due_at' | 'due_date' | 'reminder_at' | 'all_day' | 'place' | 'status' | 'completed_at' | 'deferred_until_date'
>;

export type EventUpdate = Pick<
  EventRecord,
  'title' | 'start_at' | 'end_at' | 'start_date' | 'end_date' | 'all_day' | 'timezone' | 'place' | 'status'
>;

export interface CalendarStatus {
  configured: boolean;
  state: 'not_configured' | 'configured' | 'discovered' | 'syncing' | 'ready' | 'error';
  calendar_name?: string;
  calendar_path?: string;
  last_attempt_at?: string;
  last_success_at?: string;
  last_error?: string;
  conflict_count: number;
}

export interface CalendarConflict {
  local_event_id: string;
  remote_path: string;
  kind: string;
  title: string;
  updated_at: string;
}

export interface CalendarSyncSummary {
  pulled: number;
  pushed: number;
  deleted: number;
  conflicts: number;
  synced_at: string;
}

export interface NotificationRecord {
  id: string;
  task_id: string;
  title: string;
  place?: string;
  scheduled_at: string;
  created_at: string;
}
