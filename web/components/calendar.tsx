// Calendar and tasks, with a Day/Week toggle. On desktop the task list sits beside the
// calendar; on the phone it is its own section below.

import type { ComponentChildren } from "preact";
import { useState } from "preact/hooks";
import type { HomeView } from "../../src/home/types";
import { dateSpan, shortDate } from "../lib/format";
import { DayTimeline } from "./day-timeline";
import { Segmented } from "./segmented";
import { WeekColumns, WeekStrip } from "./week";

type View = "day" | "week";

interface Props {
  view: HomeView;
  nowMin: number;
  isPhone: boolean;
  onComplete: (id: string) => void;
  /** The task list, beside the calendar on desktop. */
  aside?: ComponentChildren;
}

export function Calendar({ view, nowMin, isPhone, onComplete, aside }: Props) {
  const [mode, setMode] = useState<View>("day");
  const today = view.days[0];
  const last = view.days.at(-1);
  const title = mode === "day" || !last ? shortDate(view.date) : dateSpan(view.date, last.date);
  return (
    <section class="section">
      <div class="section-head">
        <h2>{title}</h2>
        <Segmented
          label="Calendar range"
          segments={[
            { value: "day", label: "Day" },
            { value: "week", label: "Week" },
          ]}
          value={mode}
          onChange={setMode}
        />
      </div>
      <div class="calendar-grid">
        <div>
          {mode === "day" && today && (
            <DayTimeline day={today} nowMin={nowMin} isPhone={isPhone} onComplete={onComplete} />
          )}
          {mode === "week" && !isPhone && <WeekColumns days={view.days} nowMin={nowMin} />}
          {mode === "week" && isPhone && <WeekStrip days={view.days} />}
        </div>
        {aside && <aside>{aside}</aside>}
      </div>
    </section>
  );
}
