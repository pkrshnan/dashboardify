// Geometry for the Day timeline: which hours it shows, and where each event block and reminder
// pill goes. Pure, so it is unit tested without a browser.

import type { AgendaEvent, Reminder } from "../../src/home/types";

const LAST_START_HOUR = 20;
const DEFAULT_END_HOUR = 22;
const MIN_HOURS = 3;

export interface HourRange {
  startHour: number;
  endHour: number;
  /** The hour the timeline opens scrolled to; earlier hours are above it. */
  viewHour: number;
}

/**
 * Shown from an hour before now to 22:00, stretched to fit anything later. Hours before that are
 * drawn too when something is in them, so a past task can still be ticked off.
 */
export function hourRange(nowMin: number, events: AgendaEvent[], reminders: Reminder[]): HourRange {
  const viewHour = Math.min(LAST_START_HOUR, Math.max(0, Math.floor(nowMin / 60) - 1));
  const startHour = Math.min(
    viewHour,
    ...events.map((e) => Math.floor(Math.max(0, e.startMin) / 60)),
    ...reminders.map((r) => Math.floor(r.minutes / 60)),
  );
  const latest = Math.max(
    0,
    ...events.map((e) => Math.ceil(e.endMin / 60)),
    ...reminders.map((r) => Math.floor(r.minutes / 60) + 1),
  );
  const endHour = Math.min(24, Math.max(DEFAULT_END_HOUR, latest, viewHour + MIN_HOURS));
  return { startHour, endHour, viewHour };
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
  const spans = visible.map((event) => {
    const from = Math.max(event.startMin, startMin);
    const to = Math.min(event.endMin, endMin);
    const top = ((from - startMin) / 60) * hourPx;
    const height = Math.max(MIN_BLOCK_PX, ((to - from) / 60) * hourPx - 2);
    return { start: top, end: top + height };
  });
  // Lanes come from the drawn blocks, so a short event stretched to MIN_BLOCK_PX gets its own lane
  // instead of covering the one after it.
  const lanes = assignLanes(spans);
  return visible.map((event, i) => {
    const { start: top, end } = spans[i] ?? { start: 0, end: 0 };
    const height = end - top;
    return {
      event,
      top,
      height,
      lane: lanes[i]?.lane ?? 0,
      lanes: lanes[i]?.lanes ?? 1,
      past: event.endMin <= nowMin,
      next: event === nextEvent,
      oneLine: height < ONE_LINE_PX,
    };
  });
}

/** Greedy lanes per cluster of overlapping spans (spans sorted by start). */
export function assignLanes(
  spans: { start: number; end: number }[],
): { lane: number; lanes: number }[] {
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
  spans.forEach((s, index) => {
    if (s.start >= clusterEnd) {
      closeCluster();
    }
    const free = laneEnds.findIndex((end) => end <= s.start);
    const lane = free === -1 ? laneEnds.length : free;
    laneEnds[lane] = s.end;
    clusterEnd = Math.max(clusterEnd, s.end);
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
