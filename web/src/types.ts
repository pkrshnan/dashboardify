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
  capture_id: string;
  title: string;
  start_at?: string;
  start_date?: string;
  all_day?: boolean;
  timezone: string;
  place?: string;
  created_at: string;
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
