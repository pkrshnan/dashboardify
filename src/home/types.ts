import type { CaptureHints } from "./calendar";
// The shape of GET /api/home: everything the home screen shows, already worked out on the server
// so the web app only lays it out. The web app imports these types directly.

export type Tone = "good" | "bad" | "neutral";
export type Category = "work" | "fitness" | "personal" | "relationships" | "family" | "focus";
export type HealthGroup = "heart" | "sleep" | "activity" | "vitals";
export type TaskGroupName = "Overdue" | "Today" | "This week" | "Later" | "Someday";

export interface HomeView {
  timeZone: string;
  /** Today, YYYY-MM-DD in the server's time zone. */
  date: string;
  generatedAt: string;
  /** One plain sentence: judgement and the next action. */
  sentence: string;
  next: NextEvent | null;
  /** Seven days from today, for the Day and Week views. */
  days: DayAgenda[];
  tasks: TaskGroup[];
  health: MetricTrend[];
  /** When strap data last arrived, or null before the first upload. */
  healthSync: HealthSyncView | null;
  /** When calendars last synced, or null with no calendar connected. */
  calendarSync: CalendarSyncView | null;
  /** For the capture box's calendar guess, or null with no writable calendar. */
  captureHints: CaptureHints | null;
}

export interface CalendarSyncView {
  /** ISO time, or null before the first sync finishes. */
  lastSync: string | null;
  hasErrors: boolean;
}

export interface HealthSyncView {
  /** ISO time of the newest stored sample. */
  latestSample: string;
  /** ISO time the last upload landed. */
  upload: string;
  /** The strap's latest battery report, or null before it sends one. */
  battery: BatteryView | null;
}

export interface BatteryView {
  /** 0 to 100. */
  percent: number;
  /** False until the strap reports a charger change. */
  charging: boolean;
  /** ISO time of the report. */
  at: string;
}

export interface AgendaEvent {
  title: string;
  /** HH:MM local time. */
  start: string;
  end: string;
  /** Minutes after local midnight; `endMin` can pass 1440 for an event that runs past midnight. */
  startMin: number;
  endMin: number;
  detail: string;
  category: Category;
  url: string | null;
  /** Apple Maps, for an event whose location has coordinates. */
  mapsUrl: string | null;
  /** `events/{id}`, or null for events not from a calendar resource. */
  event: string | null;
  /** `calendarAccounts/{a}/calendars/{c}`, or null. */
  calendar: string | null;
  writable: boolean;
  allDay: boolean;
  /** Client only: drawn while the capture box is still saving it. */
  pending?: boolean;
}

export interface NextEvent {
  title: string;
  start: string;
  detail: string;
  /** Minutes from now until it starts; 0 or less while it is on. */
  inMin: number;
  url: string | null;
  mapsUrl: string | null;
}

/** A task with a time: drawn on the timeline, never in the task list. */
export interface Reminder {
  id: string;
  text: string;
  time: string;
  minutes: number;
  done: boolean;
}

export interface DayAgenda {
  date: string;
  events: AgendaEvent[];
  reminders: Reminder[];
  /** Untimed tasks due that day, shown as hollow markers in the week view. */
  dated: string[];
  /** All-day events that day: a row above the Day timeline, and markers in the Week view. */
  allDay: AgendaEvent[];
}

export interface TaskItem {
  id: string;
  text: string;
  /** "3d late", "Thu", "Fri 15:00", "12 Dec" or "". */
  meta: string;
}

export interface TaskGroup {
  name: TaskGroupName;
  tasks: TaskItem[];
}

export interface MetricTrend {
  key: string;
  name: string;
  unit: string;
  group: HealthGroup;
  /** The number to show, formatted ("62", "7h 12m", "9,840"), or null when there is none. */
  value: string | null;
  /** Raw value, for the recovery colour band. */
  raw: number | null;
  /** "−11%", "+0.1 °C", or null without enough history. */
  delta: string | null;
  tone: Tone;
  /** Cumulative metrics: the last value is today's running total, left out of the change. */
  partial: boolean;
  /** Yesterday's completed total, formatted, for cumulative metrics. */
  yesterdayValue: string | null;
  /** Mean and SD of the baseline (the 60 days before the last 7), for the chart band. */
  baseline: { mean: number; sd: number } | null;
  /** Daily values, oldest first, ending at `lastDate`. Missing days are null. */
  values: (number | null)[];
  lastDate: string;
}
