// Habits, at `#/habits/<habit>` (docs/habits.md#web): a row per habit with its streak and a
// GitHub-style grid of weeks, and the selected habit's settings beside the list. The phone shows
// the list at `#/habits` and one habit at `#/habits/<habit>`; `new` is the form for a new one.

import { useCallback, useEffect, useState } from "preact/hooks";
import {
  createHabit,
  fetchHabitDays,
  fetchHabitFacts,
  fetchHabits,
  type HabitInput,
  markHabit,
  type Token,
  Unauthorized,
  updateHabit,
} from "../api";
import { HabitForm } from "../components/habit-form";
import { dayMonth } from "../lib/format";
import {
  dayLabel,
  dayOfWeek,
  type FactView,
  type GridCell,
  gridStart,
  gridWeeks,
  type HabitDayView,
  type HabitView,
  monthLabels,
  progressNote,
  ruleLabel,
  scheduleLabel,
  thisWeekDots,
  type WeekBox,
  weekBoxes,
  withTick,
} from "../lib/habits";
import { href } from "../lib/router";
import { navigate } from "../lib/use-route";
import { useApp } from "./context";
import type { Module, PageProps } from "./types";

export const habits: Module = {
  id: "habits",
  title: "Habits",
  icon: "habits",
  path: "/habits/:habit?",
  key: "b",
  nav: { group: 2, phone: "more" },
  needsHome: false,
  view: HabitsPage,
};

const DESKTOP_WEEKS = 36;
const PHONE_WEEKS = 23;
const LONG_DAYS = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"];

function HabitsPage({ params }: PageProps) {
  const { isPhone } = useApp();
  const { all, facts, reload } = useHabitList();
  if (!(all && facts)) {
    return null;
  }
  const selected = params.habit ?? (isPhone ? undefined : (all[0]?.id ?? "new"));
  const habit = all.find((h) => h.id === selected) ?? null;
  const panel = (
    <HabitPanel key={selected} habit={habit} facts={facts} back={isPhone} onSaved={reload} />
  );
  if (isPhone) {
    return (
      <main class="habits phone">
        {selected ? (
          panel
        ) : (
          <HabitList all={all} facts={facts} weeks={PHONE_WEEKS} reload={reload} />
        )}
      </main>
    );
  }
  return (
    <main class="habits">
      <HabitList all={all} facts={facts} weeks={DESKTOP_WEEKS} current={selected} reload={reload} />
      {panel}
    </main>
  );
}

/** Every habit not archived, and the facts a rule can use, reloaded after a change. */
function useHabitList() {
  const { token, onUnauthorized } = useApp();
  const [all, setAll] = useState<HabitView[] | null>(null);
  const [facts, setFacts] = useState<FactView[] | null>(null);
  const reload = useCallback(async () => {
    try {
      const [habits, known] = await Promise.all([fetchHabits(token), fetchHabitFacts(token)]);
      setAll(habits);
      setFacts(known);
    } catch (error) {
      if (error instanceof Unauthorized) {
        onUnauthorized(error.setup);
      }
    }
  }, [token, onUnauthorized]);
  useEffect(() => {
    reload();
  }, [reload]);
  return { all, facts, reload };
}

function HabitList(props: {
  all: HabitView[];
  facts: FactView[];
  weeks: number;
  current?: string;
  reload: () => Promise<void>;
}) {
  const { isPhone } = useApp();
  const today = props.all[0]?.progress.day ?? new Date().toISOString().slice(0, 10);
  const months = monthLabels(gridWeeks([], today, props.weeks));
  return (
    <section class="habit-list" aria-label="Habits">
      <header class="habit-head">
        <div>
          <h1 class="habit-heading">Habits</h1>
          <p class="muted">{todayLine(props.all, today)}</p>
        </div>
        <a class="habit-new" href={href("/habits/new")} aria-label="New habit">
          {isPhone ? "+" : "+ New habit"}
        </a>
      </header>
      {props.all.length === 0 && <p class="muted">No habits yet.</p>}
      <div class="habit-rows">
        {props.all.length > 0 && (
          <div class="habit-months" aria-hidden="true">
            {months.map((m, i) => (
              <span key={i}>{m}</span>
            ))}
          </div>
        )}
        {props.all.map((habit) => (
          <HabitRow
            key={habit.name}
            habit={habit}
            facts={props.facts}
            weeks={props.weeks}
            selected={habit.id === props.current}
            onChanged={props.reload}
          />
        ))}
      </div>
    </section>
  );
}

/** "Thursday 12 Nov · 2 of 5 done today". */
function todayLine(all: HabitView[], today: string): string {
  const due = all.filter((h) => h.state === "active" && (h.progress.due || h.progress.done));
  const done = due.filter((h) => h.progress.done).length;
  const date = `${LONG_DAYS[dayOfWeek(today) - 1]} ${dayMonth(today)}`;
  return `${date} · ${done} of ${due.length} done today`;
}

/** One habit's days for the grid; a tick shows at once and is then read back. */
function useHabitDays(token: Token, habit: HabitView, weeks: number, onChanged: () => void) {
  const today = habit.progress.day;
  const [days, setDays] = useState<HabitDayView[]>([]);
  const load = useCallback(async () => {
    setDays(await fetchHabitDays(token, habit.id, gridStart(today, weeks), today));
  }, [token, habit.id, today, weeks]);
  useEffect(() => {
    load().catch(() => undefined);
  }, [load]);
  const tick = async (date: string, done: boolean) => {
    setDays((shown) => withTick(shown, date, done));
    try {
      await markHabit(token, habit.id, date, done);
    } finally {
      await load();
      onChanged();
    }
  };
  return { days, tick };
}

function HabitRow(props: {
  habit: HabitView;
  facts: FactView[];
  weeks: number;
  selected: boolean;
  onChanged: () => void;
}) {
  const { token, isPhone } = useApp();
  const { habit } = props;
  const { days, tick } = useHabitDays(token, habit, props.weeks, props.onChanged);
  const today = habit.progress.day;
  const paused = habit.state !== "active";
  const weekly = habit.schedule.kind === "weekly";
  return (
    <div
      class={`habit-row${props.selected ? " selected" : ""}${paused ? " paused" : ""}`}
      style={{ "--habit-color": habit.color || "var(--control)" }}
    >
      <div class="habit-label">
        <TickButton
          habit={habit}
          done={doneOn(days, habit.progress.day) ?? habit.progress.done}
          onTick={(done) => tick(habit.progress.day, done)}
        />
        <a class="habit-name" href={href(`/habits/${habit.id}`)}>
          <span class="habit-title">{habit.displayName}</span>
          <span class="habit-sub">{subLine(habit, props.facts)}</span>
          <Streak habit={habit} facts={props.facts} />
        </a>
        {weekly && !paused && <WeekDots habit={habit} days={days} onTick={tick} />}
      </div>
      {weekly ? (
        <WeekGrid
          boxes={weekBoxes(days, today, props.weeks, habit.schedule.times)}
          times={habit.schedule.times}
          name={habit.displayName}
        />
      ) : (
        <HabitGrid
          cells={gridWeeks(days, today, props.weeks)}
          name={habit.displayName}
          onToggle={isPhone ? undefined : (cell) => tick(cell.date, cell.state !== "done")}
        />
      )}
    </div>
  );
}

function subLine(habit: HabitView, facts: FactView[]): string {
  const rule = ruleLabel(habit.auto, facts);
  return [scheduleLabel(habit.schedule), rule].filter(Boolean).join(" · ");
}

/** Whether the row's days say `date` is done, or null before they've loaded. */
function doneOn(days: HabitDayView[], date: string): boolean | null {
  const day = days.find((d) => d.date === date);
  return day ? day.mark === "done" : null;
}

/**
 * Today's tick. `done` comes from the row's days, which a tick changes at once, so the button
 * doesn't wait for the habits list to reload.
 */
function TickButton(props: { habit: HabitView; done: boolean; onTick: (done: boolean) => void }) {
  const { habit, done } = props;
  return (
    <button
      type="button"
      class="habit-tick"
      aria-pressed={done}
      aria-label={`${done ? "Untick" : "Tick"} ${habit.displayName} for today`}
      onClick={() => props.onTick(!done)}
    >
      <span class="habit-tick-ring">
        {done && (
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M5 12.5l4.5 4.5L19 7.5" />
          </svg>
        )}
      </span>
    </button>
  );
}

function Streak({ habit, facts }: { habit: HabitView; facts: FactView[] }) {
  if (habit.state === "paused") {
    return <span class="habit-note">Paused</span>;
  }
  const { streak, unit, atRisk } = habit.progress;
  return (
    <>
      <span class={`habit-streak${atRisk ? " at-risk" : ""}`}>
        <span class="habit-streak-n">{streak}</span> {streak === 1 ? unit : `${unit}s`}
      </span>
      {habit.schedule.kind !== "weekly" && (
        <span class={`habit-note${atRisk ? " at-risk" : ""}`}>{progressNote(habit, facts)}</span>
      )}
    </>
  );
}

/**
 * This week as one dot per time. They sit outside the name's link, being buttons: the next empty
 * dot ticks a day (dotDay says which) and the last filled one unticks it. The rest only show.
 */
function WeekDots(props: {
  habit: HabitView;
  days: HabitDayView[];
  onTick: (date: string, done: boolean) => void;
}) {
  const dots = thisWeekDots(props.habit, props.days);
  const done = dots.filter((d) => d.on).length;
  return (
    <fieldset class="habit-dots" aria-label={`${done} of ${dots.length} this week`}>
      {dots.map(({ on, date }, i) => {
        const cls = `habit-dot${on ? " on" : ""}`;
        if (!date) {
          return (
            <span key={i} class={cls}>
              <span />
            </span>
          );
        }
        const label = `${on ? "Untick" : "Tick"} ${dayLabel(date)}`;
        return (
          <button
            type="button"
            key={i}
            class={cls}
            aria-label={label}
            title={label}
            onClick={() => props.onTick(date, !on)}
          >
            <span />
          </button>
        );
      })}
    </fieldset>
  );
}

/** A weekly habit's grid: one square per week, filled once the week is met. Read-only. */
function WeekGrid(props: { boxes: WeekBox[]; times: number; name: string }) {
  return (
    <div
      class="habit-grid weeks"
      role="img"
      aria-label={`${props.name}, last ${props.boxes.length} weeks`}
    >
      {props.boxes.map((box) => (
        <span
          key={box.monday}
          class={`habit-cell ${box.state}${box.isCurrent ? " today" : ""}`}
          title={`Week of ${dayMonth(box.monday)} · ${box.done} of ${props.times}`}
        />
      ))}
    </div>
  );
}

/** Weeks as columns, Monday at the top. With `onToggle` each square is a button. */
function HabitGrid(props: {
  cells: GridCell[][];
  name: string;
  onToggle?: (cell: GridCell) => void;
}) {
  const { onToggle } = props;
  const label = `${props.name}, last ${props.cells.length} weeks`;
  const weeks = props.cells.map((week) => (
    <div key={week[0]?.date} class="habit-week">
      {week.map((cell) =>
        onToggle && cell.canTick ? (
          <button
            type="button"
            key={cell.date}
            class={cellClass(cell)}
            title={cellTitle(cell)}
            aria-label={cellTitle(cell)}
            onClick={() => onToggle(cell)}
          />
        ) : (
          <span key={cell.date} class={cellClass(cell)} />
        ),
      )}
    </div>
  ));
  return onToggle ? (
    <fieldset class="habit-grid" aria-label={label}>
      {weeks}
    </fieldset>
  ) : (
    <div class="habit-grid" role="img" aria-label={label}>
      {weeks}
    </div>
  );
}

function cellClass(cell: GridCell): string {
  return `habit-cell ${cell.state}${cell.isToday ? " today" : ""}`;
}

const STATE_WORDS: Record<GridCell["state"], string> = {
  done: "done",
  missed: "not done",
  off: "not scheduled",
  pending: "not known yet",
  empty: "before it started",
};

function cellTitle(cell: GridCell): string {
  return `${dayLabel(cell.date)} · ${STATE_WORDS[cell.state]}`;
}

/** The settings beside the list, or on the phone the habit's own screen. */
function HabitPanel(props: {
  habit: HabitView | null;
  facts: FactView[];
  back: boolean;
  onSaved: () => Promise<void>;
}) {
  const { token } = useApp();
  const { habit } = props;
  const [added, setAdded] = useState<{ name: string; count: number } | null>(null);
  const save = async (input: HabitInput) => {
    if (habit) {
      await updateHabit(token, habit.id, input);
      await props.onSaved();
      return;
    }
    const created = await createHabit(token, input);
    await props.onSaved();
    // A blank form again, so the next habit can follow; the list shows the one just added.
    setAdded({ name: created.displayName, count: (added?.count ?? 0) + 1 });
    navigate(href("/habits/new"));
  };
  const setState = async (state: HabitView["state"]) => {
    if (habit) {
      await updateHabit(token, habit.id, { state });
      await props.onSaved();
    }
  };
  return (
    <aside class="habit-panel" aria-label="Habit settings">
      {props.back && (
        <a class="habit-back" href={href("/habits")}>
          ‹ Habits
        </a>
      )}
      <h2 class="habit-panel-title">{habit ? habit.displayName : "New habit"}</h2>
      <p class="habit-path">Habits.md</p>
      {props.back && habit && <ThisWeek habit={habit} onChanged={props.onSaved} />}
      <HabitForm key={added?.count ?? 0} habit={habit} facts={props.facts} onSave={save} />
      {added && !habit && (
        <p class="habit-added" role="status">
          Added {added.name}.
        </p>
      )}
      {habit && (
        <div class="habit-actions">
          <button
            type="button"
            class="habit-action"
            onClick={() => setState(habit.state === "paused" ? "active" : "paused")}
          >
            {habit.state === "paused" ? "Resume" : "Pause"}
          </button>
          <button type="button" class="habit-action" onClick={() => setState("archived")}>
            Archive
          </button>
        </div>
      )}
    </aside>
  );
}

/** This week's seven days as buttons, so the phone can fix a day. */
function ThisWeek(props: { habit: HabitView; onChanged: () => void }) {
  const { token } = useApp();
  const { days, tick } = useHabitDays(token, props.habit, 1, props.onChanged);
  const [week] = gridWeeks(days, props.habit.progress.day, 1);
  return (
    <fieldset class="habit-this-week" aria-label="This week">
      {week?.map((cell, i) => (
        <button
          type="button"
          key={cell.date}
          class={`habit-week-day ${cellClass(cell)}`}
          disabled={!cell.canTick}
          aria-pressed={cell.state === "done"}
          aria-label={cellTitle(cell)}
          onClick={() => tick(cell.date, cell.state !== "done")}
        >
          {LONG_DAYS[i]?.charAt(0)}
        </button>
      ))}
    </fieldset>
  );
}
