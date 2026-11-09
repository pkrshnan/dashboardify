// The Week view: a rolling week from today. Desktop shows seven columns with dated tasks at the
// top of each; the phone shows a strip of days and the agenda for the chosen one. Reminders have
// hollow markers, events filled ones, and all-day events hollow squares in their colour. Nothing here can be ticked: that happens in the task list.

import { useState } from "preact/hooks";
import type { DayAgenda } from "../../src/home/types";
import { alpha, CATEGORY, TEXT_3 } from "../lib/colors";
import { dayLabel, dayOfMonth, hourLabel, weekday } from "../lib/format";
import { assignLanes } from "../lib/timeline";

const FIRST_HOUR = 7;
const LAST_HOUR = 22;
const HOUR_PX = 36;

export function WeekColumns({ days, nowMin }: { days: DayAgenda[]; nowMin: number }) {
  const height = (LAST_HOUR - FIRST_HOUR) * HOUR_PX;
  const y = (min: number) =>
    ((Math.min(Math.max(min, FIRST_HOUR * 60), LAST_HOUR * 60) - FIRST_HOUR * 60) / 60) * HOUR_PX;
  const labelHours = Array.from(
    { length: (LAST_HOUR - FIRST_HOUR) / 2 + 1 },
    (_, i) => FIRST_HOUR + i * 2,
  );
  return (
    <div class="week">
      <div class="week-hours">
        <div style={{ position: "absolute", top: "84px", height: `${height}px`, width: "28px" }}>
          {labelHours.map((h) => (
            <span
              key={h}
              style={{ position: "absolute", top: `${(h - FIRST_HOUR) * HOUR_PX - 6}px` }}
            >
              {hourLabel(h)}
            </span>
          ))}
        </div>
      </div>
      <div class="week-cols">
        {days.map((d, i) => (
          <div key={d.date} class="week-col">
            <div class={`week-day${i === 0 ? " today" : ""}`}>{dayLabel(d.date)}</div>
            <WeekDated day={d} />
            <div
              class="week-body"
              style={{
                height: `${height}px`,
                backgroundImage: `repeating-linear-gradient(to bottom, var(--line-2) 0, var(--line-2) 1px, transparent 1px, transparent ${HOUR_PX * 2}px)`,
              }}
            >
              <WeekEvents day={d} y={y} />
              {d.reminders.map((r) => (
                <div key={r.id} class="week-reminder ell" style={{ top: `${y(r.minutes)}px` }}>
                  <span class="hollow" />
                  <span class="ell">{r.text}</span>
                </div>
              ))}
              {i === 0 && nowMin >= FIRST_HOUR * 60 && nowMin <= LAST_HOUR * 60 && (
                <div class="now-line" style={{ left: 0, top: `${y(nowMin)}px` }} />
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A column's event blocks, with overlapping ones side by side as on the Day timeline. */
function WeekEvents({ day, y }: { day: DayAgenda; y: (min: number) => number }) {
  const spans = day.events.map((e) => {
    const top = y(e.startMin);
    return { start: top, end: top + Math.max(20, y(e.endMin) - top - 2) };
  });
  const lanes = assignLanes(spans);
  return (
    <>
      {day.events.map((e, i) => {
        const { lane = 0, lanes: count = 1 } = lanes[i] ?? {};
        const span = spans[i] ?? { start: 0, end: 0 };
        return (
          <div
            key={`${e.start}${e.title}-${i}`}
            class="week-event ell"
            title={e.title}
            style={{
              left: `calc(${(lane * 100) / count}% + 2px)`,
              width: `calc(${100 / count}% - 4px)`,
              top: `${span.start}px`,
              height: `${span.end - span.start}px`,
              background: alpha(CATEGORY[e.category], 0.15),
              borderLeft: `2px solid ${CATEGORY[e.category]}`,
            }}
          >
            {e.title}
          </div>
        );
      })}
    </>
  );
}

/** The top of a Week column: all-day events, then tasks due that day with no time. */
function WeekDated({ day }: { day: DayAgenda }) {
  return (
    <div class="week-dated">
      {day.allDay.map((e) => (
        <div key={`a${e.event ?? e.title}`} title={`${e.title}, all day`}>
          <span class="hollow all-day" style={{ borderColor: CATEGORY[e.category] }} />
          <span class="ell">{e.title}</span>
        </div>
      ))}
      {day.dated.map((text) => (
        <div key={text}>
          <span class="hollow" />
          <span class="ell">{text}</span>
        </div>
      ))}
    </div>
  );
}

interface AgendaItem {
  key: string;
  time: string;
  text: string;
  color: string;
  filled: boolean;
  /** All-day events: a square marker, so they read as events and not tasks. */
  square?: boolean;
}

export function WeekStrip({ days }: { days: DayAgenda[] }) {
  const [selected, setSelected] = useState(0);
  const day = days[selected] ?? days[0];
  return (
    <div>
      <div class="day-strip">
        {days.map((d, i) => (
          <button
            key={d.date}
            type="button"
            aria-pressed={i === selected}
            aria-label={dayLabel(d.date)}
            onClick={() => setSelected(i)}
          >
            <span class="dow">{weekday(d.date)}</span>
            <span class="num" style={{ fontWeight: i === 0 ? 600 : 400 }}>
              {dayOfMonth(d.date)}
            </span>
            <span class="dot" style={{ background: hasItems(d) ? TEXT_3 : "transparent" }} />
          </button>
        ))}
      </div>
      <div class="agenda">
        {day &&
          agendaOf(day).map((item) => (
            <div key={item.key} class="agenda-row">
              <span class="agenda-time">{item.time}</span>
              <span
                class={`agenda-marker${item.square ? " all-day" : ""}`}
                style={{
                  borderColor: item.color,
                  background: item.filled ? item.color : "transparent",
                }}
              />
              <span class="ell">{item.text}</span>
            </div>
          ))}
        {day && agendaOf(day).length === 0 && <div class="agenda-row muted">Nothing planned.</div>}
      </div>
    </div>
  );
}

function hasItems(d: DayAgenda): boolean {
  return d.events.length + d.reminders.length + d.dated.length + d.allDay.length > 0;
}

/** Untimed tasks first, then events and reminders by time. */
function agendaOf(day: DayAgenda): AgendaItem[] {
  const timed = [
    ...day.events.map((e) => ({
      sort: e.startMin,
      item: {
        key: `e${e.start}${e.title}${e.event ?? ""}`,
        time: e.start,
        text: e.title,
        color: CATEGORY[e.category],
        filled: true,
      },
    })),
    ...day.reminders.map((r) => ({
      sort: r.minutes,
      item: { key: `r${r.id}`, time: r.time, text: r.text, color: TEXT_3, filled: false },
    })),
  ].sort((a, b) => a.sort - b.sort);
  const allDay = day.allDay.map((e) => ({
    key: `a${e.event ?? e.title}`,
    time: "All day",
    text: e.title,
    color: CATEGORY[e.category],
    filled: false,
    square: true,
  }));
  const dated = day.dated.map((text) => ({
    key: `d${text}`,
    time: "",
    text,
    color: TEXT_3,
    filled: false,
  }));
  return [...allDay, ...dated, ...timed.map((t) => t.item)];
}
