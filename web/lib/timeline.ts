// Geometry for the Day timeline: which hours it shows, and where each event block and reminder
// pill goes. Pure, so it is unit tested without a browser.

import type { AgendaEvent, Reminder } from "../../src/home/types";

const LAST_START_HOUR = 20;
const DEFAULT_END_HOUR = 22;
const MIN_HOURS = 3;

export interface HourRange {
  startHour: number;
  endHour: number;
}

/** From an hour before now to 22:00, stretched to fit anything later. */
export function hourRange(nowMin: number, events: AgendaEvent[], reminders: Reminder[]): HourRange {
  const startHour = Math.min(LAST_START_HOUR, Math.max(0, Math.floor(nowMin / 60) - 1));
  const latest = Math.max(
    0,
    ...events.map((e) => Math.ceil(e.endMin / 60)),
    ...reminders.map((r) => Math.floor(r.minutes / 60) + 1),
  );
  const endHour = Math.min(24, Math.max(DEFAULT_END_HOUR, latest, startHour + MIN_HOURS));
  return { startHour, endHour };
}

export interface Block {
  event: AgendaEvent;
  top: number;
  height: number;
  /** Side-by-side position when events overlap: lane index and lane count. */
  lane: number;
  lanes: number;
  past: boolean;
  next: boolean;
  /** Short blocks put title, time and detail on one line. */
  oneLine: boolean;
}

const MIN_BLOCK_PX = 26;
const ONE_LINE_PX = 46;

/** Event blocks inside the range, with overlapping events split into lanes. */
export function layoutBlocks(
  events: AgendaEvent[],
  range: HourRange,
  hourPx: number,
  nowMin: number,
): Block[] {
  const startMin = range.startHour * 60;
  const endMin = range.endHour * 60;
  const visible = events.filter((e) => e.endMin > startMin && e.startMin < endMin);
  const nextEvent = events.find((e) => e.endMin > nowMin);
  const lanes = assignLanes(visible);
  return visible.map((event, i) => {
    const from = Math.max(event.startMin, startMin);
    const to = Math.min(event.endMin, endMin);
    const height = Math.max(MIN_BLOCK_PX, ((to - from) / 60) * hourPx - 2);
    return {
      event,
      top: ((from - startMin) / 60) * hourPx,
      height,
      lane: lanes[i]?.lane ?? 0,
      lanes: lanes[i]?.lanes ?? 1,
      past: event.endMin <= nowMin,
      next: event === nextEvent,
      oneLine: height < ONE_LINE_PX,
    };
  });
}

/** Greedy lanes per cluster of overlapping events (events sorted by start). */
export function assignLanes(events: AgendaEvent[]): { lane: number; lanes: number }[] {
  const result: { lane: number; lanes: number }[] = [];
  let cluster: number[] = [];
  let laneEnds: number[] = [];
  let clusterEnd = -1;
  const closeCluster = () => {
    for (const index of cluster) {
      const entry = result[index];
      if (entry) {
        entry.lanes = laneEnds.length;
      }
    }
    cluster = [];
    laneEnds = [];
  };
  events.forEach((e, index) => {
    if (e.startMin >= clusterEnd) {
      closeCluster();
    }
    const free = laneEnds.findIndex((end) => end <= e.startMin);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = e.endMin;
    clusterEnd = Math.max(clusterEnd, e.endMin);
    cluster.push(index);
    result.push({ lane, lanes: 1 });
  });
  closeCluster();
  return result;
}

export interface Pill {
  reminder: Reminder;
  /** Where its time is on the timeline. */
  lineTop: number;
  /** The pill's centre, pushed down when it would overlap the one above. */
  top: number;
}

/** Reminder pills inside the range, nudged apart so they never overlap. */
export function layoutPills(
  reminders: Reminder[],
  range: HourRange,
  hourPx: number,
  pillPx: number,
): Pill[] {
  const startMin = range.startHour * 60;
  const pills: Pill[] = [];
  let lastTop = Number.NEGATIVE_INFINITY;
  for (const reminder of reminders) {
    if (reminder.minutes < startMin || reminder.minutes > range.endHour * 60) {
      continue;
    }
    const lineTop = ((reminder.minutes - startMin) / 60) * hourPx;
    const top = Math.max(lineTop, lastTop + pillPx + 4);
    pills.push({ reminder, lineTop, top });
    lastTop = top;
  }
  return pills;
}
