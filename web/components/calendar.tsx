// Calendar and tasks, with a Day/Week toggle and the capture box under the heading. On desktop the task list sits beside the
// calendar; on the phone it is its own section below.

import type { ComponentChildren } from "preact";
import type { CalendarSyncView, HomeView } from "../../src/home/types";
import { nowIn } from "../lib/clock";
import { STATUS } from "../lib/colors";
import { dateSpan, shortDate } from "../lib/format";
import { DayTimeline } from "./day-timeline";
import { Segmented } from "./segmented";
import { WeekColumns, WeekStrip } from "./week";

export type CalendarMode = "day" | "week";

interface Props {
  view: HomeView;
  /** Day or Week, from the address (`?view=week`). */
  mode: CalendarMode;
  onMode: (mode: CalendarMode) => void;
  nowMin: number;
  isPhone: boolean;
  onComplete: (id: string) => void;
  onReopen: (id: string) => void;
  /** Opens the event panel for "events/{id}". */
  onOpenEvent?: (event: string) => void;
  /** The capture box, under the heading. */
  capture?: ComponentChildren;
  /** The task list, beside the calendar on desktop. */
  aside?: ComponentChildren;
}

export function Calendar(props: Props) {
  const { view, mode, nowMin, isPhone, onComplete, onReopen, capture, aside } = props;
  const today = view.days[0];
  const last = view.days.at(-1);
  const title = mode === "day" || !last ? shortDate(view.date) : dateSpan(view.date, last.date);
  return (
    <section class="section">
      <div class="section-head">
        <div class="health-title">
          <h2>{title}</h2>
          {view.calendarSync && (
            <div class="range-label">
              <CalendarSynced sync={view.calendarSync} timeZone={view.timeZone} />
            </div>
          )}
        </div>
        <Segmented
          label="Calendar range"
          segments={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
          ]}
          value={mode}
          onChange={props.onMode}
        />
      </div>
      {capture}
      <div class="calendar-grid">
        <div>
          {mode === "day" && today && (
            <DayTimeline
              day={today}
              nowMin={nowMin}
              isPhone={isPhone}
              onComplete={onComplete}
              onReopen={onReopen}
              onOpen={props.onOpenEvent}
            />
          )}
          {mode === "week" && !isPhone && (
            <WeekColumns days={view.days} nowMin={nowMin} onOpen={props.onOpenEvent} />
          )}
          {mode === "week" && isPhone && <WeekStrip days={view.days} onOpen={props.onOpenEvent} />}
        </div>
        {aside && <aside>{aside}</aside>}
      </div>
    </section>
  );
}

/** Calendars older than this are shown in orange. */
const STALE_MS = 15 * 60_000;

/** "Calendar synced 09:10"; orange when it's behind or an account needs attention. */
function CalendarSynced({ sync, timeZone }: { sync: CalendarSyncView; timeZone: string }) {
  if (sync.hasErrors) {
    return <span style={{ color: STATUS.warn }}>Calendar needs attention in Settings</span>;
  }
  if (!sync.lastSync) {
    return <span>Calendar syncing…</span>;
  }
  const stale = Date.now() - new Date(sync.lastSync).getTime() > STALE_MS;
  return (
    <span style={stale ? { color: STATUS.warn } : undefined}>
      Calendar synced {nowIn(timeZone, new Date(sync.lastSync)).time}
    </span>
  );
}
