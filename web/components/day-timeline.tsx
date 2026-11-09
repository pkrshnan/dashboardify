// The Day view: hour lines from an hour before now to 22:00, event blocks on the left, timed
// tasks as dashed pills in a lane on the right, and a red line for now. An event the capture box
// is still saving has a stronger fill and a ring.

import type { DayAgenda } from "../../src/home/types";
import { alpha, CATEGORY, TEXT, TEXT_2, TEXT_3 } from "../lib/colors";
import { hourLabel } from "../lib/format";
import { type Block, hourRange, layoutBlocks, layoutPills, type Pill } from "../lib/timeline";

interface Props {
  day: DayAgenda;
  nowMin: number;
  isPhone: boolean;
  onComplete: (id: string) => void;
}

export function DayTimeline({ day, nowMin, isPhone, onComplete }: Props) {
  const hourPx = isPhone ? 56 : 52;
  const range = hourRange(nowMin, day.events, day.reminders);
  const hours = Array.from(
    { length: range.endHour - range.startHour + 1 },
    (_, i) => range.startHour + i,
  );
  const blocks = layoutBlocks(day.events, range, hourPx, nowMin);
  const pills = layoutPills(day.reminders, range, hourPx, isPhone ? 44 : 32);
  const nowTop = ((nowMin - range.startHour * 60) / 60) * hourPx;
  const eventWidth = isPhone ? 52 : 62;
  return (
    <div class="timeline" style={{ height: `${(range.endHour - range.startHour) * hourPx}px` }}>
      {hours.map((h) => (
        <div key={h}>
          <span class="hour-label" style={{ top: `${(h - range.startHour) * hourPx}px` }}>
            {hourLabel(h)}
          </span>
          <div class="hour-line" style={{ top: `${(h - range.startHour) * hourPx}px` }} />
        </div>
      ))}
      {pills.map((p) => (
        <div key={`g${p.reminder.id}`} class="reminder-guide" style={{ top: `${p.lineTop}px` }} />
      ))}
      {blocks.map((b, i) => (
        <EventBlock key={`${b.event.start}-${i}`} block={b} width={eventWidth} isPhone={isPhone} />
      ))}
      {pills.map((p) => (
        <ReminderPill key={p.reminder.id} pill={p} isPhone={isPhone} onComplete={onComplete} />
      ))}
      {blocks.length === 0 && pills.length === 0 && (
        <div class="empty-day">Nothing on the calendar.</div>
      )}
      {nowTop >= 0 && <div class="now-line" style={{ top: `${nowTop}px` }} />}
    </div>
  );
}

function blockStyle(block: Block, laneWidth: number, color: string, fill: number) {
  const pending = block.event.pending;
  return {
    top: `${block.top}px`,
    height: `${block.height}px`,
    left: `${block.lane * laneWidth}%`,
    width: `calc(${laneWidth}% - ${block.lanes > 1 ? 4 : 0}px)`,
    // Still saving: a stronger fill and a ring, so it reads as just added.
    background: alpha(color, pending ? 0.4 : fill),
    borderLeft: `3px solid ${color}`,
    boxShadow: pending ? `0 0 0 2px ${alpha(color, 0.5)}` : undefined,
  };
}

function EventBlock({ block, width, isPhone }: { block: Block; width: number; isPhone: boolean }) {
  const { event } = block;
  const color = CATEGORY[event.category];
  const laneWidth = width / block.lanes;
  const fill = blockFill(block);
  const titleColor = block.past ? TEXT_2 : TEXT;
  const detailColor = block.past ? TEXT_3 : TEXT_2;
  const detail = [event.start, event.detail].filter((p) => p !== "").join(" · ");
  return (
    <div
      class={`event${block.oneLine ? " one-line" : ""}${event.pending ? " pending" : ""}`}
      style={blockStyle(block, laneWidth, color, fill)}
    >
      {block.oneLine || isPhone ? (
        <div class="ell">
          <span class="event-title" style={{ color: titleColor }}>
            {event.title}
          </span>{" "}
          {!isPhone && <span style={{ color: detailColor }}>{detail}</span>}
        </div>
      ) : (
        <>
          <div class="ell event-title" style={{ color: titleColor }}>
            {event.title} <span style={{ fontWeight: 400, color: detailColor }}>{event.start}</span>
          </div>
          <div class="ell" style={{ color: detailColor }}>
            {event.detail}
          </div>
        </>
      )}
      {isPhone && !block.oneLine && (
        <div class="ell" style={{ color: detailColor, fontSize: "12px", lineHeight: "16px" }}>
          {detail}
        </div>
      )}
    </div>
  );
}

/** Past blocks are dimmed by a lower fill, never by opacity; the next event is a bit brighter. */
function blockFill(block: Block): number {
  if (block.past) {
    return 0.08;
  }
  return block.next ? 0.25 : 0.15;
}

function ReminderPill(props: { pill: Pill; isPhone: boolean; onComplete: (id: string) => void }) {
  const { reminder, top } = props.pill;
  return (
    <label class={`reminder${reminder.done ? " done" : ""}`} style={{ top: `${top}px` }}>
      <input
        type="checkbox"
        class="ring sm"
        checked={reminder.done}
        disabled={reminder.done}
        aria-label={reminder.done ? "Done" : `Mark ${reminder.text} done`}
        onChange={() => props.onComplete(reminder.id)}
      />
      {props.isPhone ? (
        <span class="reminder-body">
          <span class="reminder-text ell">{reminder.text}</span>
          <span class="reminder-time">{reminder.time}</span>
        </span>
      ) : (
        <>
          <span class="reminder-text ell">{reminder.text}</span>
          <span class="muted">{reminder.time}</span>
        </>
      )}
    </label>
  );
}
