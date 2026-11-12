// The Activity page: workouts and walks over a week, a month or three months, from GET
// /v1/activityDays. A day, week or workout opens beside the list (below it on the phone).
// Workouts the strap wasn't sure of ask what they were, and the answer goes into the daily note.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import { fetchActivity, fetchWorkout, reviewWorkout, type Token, Unauthorized } from "../api";
import {
  type ActivityDayView,
  addDays,
  calendarWeeks,
  datesFrom,
  duration,
  heartRateLines,
  heartRateTicks,
  kindLabel,
  monday,
  type Range,
  REVIEW_CHOICES,
  rangeDates,
  type SetView,
  totals,
  type WorkoutDetail,
  type WorkoutView,
  weeklyMinutes,
  workoutName,
} from "../lib/activity";
import { nowIn } from "../lib/clock";
import { dayMonth, dayOfMonth, shortDate } from "../lib/format";
import { Segmented } from "./segmented";

const RANGES: { value: Range; label: string }[] = [
  { value: "week", label: "Week" },
  { value: "month", label: "Month" },
  { value: "3m", label: "3M" },
];

/** One colour per exercise, in log order; none of them are status colours. */
const EXERCISE_COLORS = ["#64d2ff", "#7d7aff", "#ac8e68", "#ff7eb6"];

type Selection = { day: string } | { week: string } | { workout: string };

interface Props {
  token: Token;
  timeZone: string;
  today: string;
  /** Week, month or 3M, from the address (`?range=month`). */
  range: Range;
  onRange: (range: Range) => void;
  onUnauthorized: (setup: boolean) => void;
}

export function Activity({ token, timeZone, today, range, onRange, onUnauthorized }: Props) {
  const [days, setDays] = useState<ActivityDayView[] | null>(null);
  const [selected, setSelected] = useState<Selection>({ day: today });
  const side = useRef<HTMLElement>(null);
  const revealing = useRef(false);
  const { start, end } = rangeDates(today, range);

  const load = useCallback(async () => {
    try {
      setDays(await fetchActivity(token, start, end));
    } catch (err) {
      if (err instanceof Unauthorized) {
        onUnauthorized(err.setup);
      }
    }
  }, [token, start, end, onUnauthorized]);
  useEffect(() => {
    load();
  }, [load]);

  const clock = (ms: number) => nowIn(timeZone, new Date(ms)).time;
  const review = async (name: string, kind: string) => {
    await reviewWorkout(token, name, kind);
    await load();
  };
  const changeRange = (r: Range) => {
    onRange(r);
    setSelected(r === "3m" ? { week: monday(today) } : { day: today });
  };
  const select = (s: Selection) => {
    revealing.current = true;
    setSelected(s);
  };
  const shown = () => {
    if (revealing.current) {
      revealing.current = false;
      reveal(side.current);
    }
  };
  const ctx = { days: days ?? [], clock, review, select, selected };

  return (
    <main class="activity">
      <section class="section">
        <div class="section-head">
          <div class="activity-title">
            <h1>Activity</h1>
          </div>
          <div class="activity-range">
            <span class="range-label">
              {dayMonth(start)} – {dayMonth(end)}
            </span>
            <Segmented label="Range" segments={RANGES} value={range} onChange={changeRange} />
          </div>
        </div>
        <TotalsRow days={ctx.days} range={range} />
      </section>
      <section class="section activity-body">
        <div class="activity-main">
          {range === "week" && <WeekList {...ctx} dates={datesFrom(start, end).reverse()} />}
          {range === "month" && <MonthGrid {...ctx} start={start} end={end} today={today} />}
          {range === "3m" && <QuarterBars {...ctx} start={start} end={end} />}
        </div>
        <aside class="activity-side" aria-live="polite" ref={side}>
          <Side {...ctx} token={token} today={today} onShowDay={select} onShown={shown} />
        </aside>
      </section>
    </main>
  );
}

/**
 * Scrolls to what was picked when it opened out of sight, as it does below the list on a phone.
 * Called once the panel has its content, so the page is long enough to bring it to the top.
 */
function reveal(el: HTMLElement | null) {
  const top = el?.getBoundingClientRect().top ?? 0;
  if (el && (top < 0 || top > window.innerHeight * 0.6)) {
    el.scrollIntoView({ behavior: "smooth", block: "start" });
  }
}

interface Ctx {
  days: ActivityDayView[];
  clock: (ms: number) => string;
  review: (name: string, kind: string) => Promise<void>;
  select: (s: Selection) => void;
  selected: Selection;
}

function TotalsRow({ days, range }: { days: ActivityDayView[]; range: Range }) {
  const t = totals(days);
  const span = { week: 7, month: 30, "3m": 91 }[range];
  return (
    <div class="activity-totals">
      <Stat
        name="Workouts"
        value={String(t.workouts)}
        detail={`${duration(t.workoutMin)}${t.toConfirm ? ` · ${t.toConfirm} to confirm` : ""}`}
      />
      <Stat name="Walks" value={String(t.walks)} detail={duration(t.walkMin)} />
      <Stat
        name="Walking steps"
        value={t.walkSteps.toLocaleString("en-US")}
        detail={`of ${t.steps.toLocaleString("en-US")} all day`}
      />
      <Stat name="Days with strap data" value={String(t.daysWithData)} detail={`of ${span}`} />
    </div>
  );
}

function Stat({ name, value, detail }: { name: string; value: string; detail: string }) {
  return (
    <div class="stat">
      <span class="stat-name">{name}</span>
      <span class="stat-value">{value}</span>
      <span class="stat-detail">{detail}</span>
    </div>
  );
}

/** The week, newest day first, every session listed. */
function WeekList(props: Ctx & { dates: string[] }) {
  return (
    <div class="day-list">
      {props.dates.map((date) => {
        const day = props.days.find((d) => d.date === date);
        return (
          <div key={date} class="day-group">
            <h3 class="act-heading">{shortDate(date)}</h3>
            {day ? <Sessions {...props} day={day} /> : <p class="muted">No strap data.</p>}
          </div>
        );
      })}
    </div>
  );
}

function MonthGrid(props: Ctx & { start: string; end: string; today: string }) {
  const selectedDay = "day" in props.selected ? props.selected.day : null;
  return (
    <div class="month">
      <div class="month-row month-dow">
        {["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"].map((d) => (
          <span key={d}>{d}</span>
        ))}
      </div>
      {calendarWeeks(props.start, props.end).map((week) => (
        <div key={week.join()} class="month-row">
          {week.map((date, i) =>
            date ? (
              <MonthDay
                key={date}
                date={date}
                day={props.days.find((d) => d.date === date)}
                today={date === props.today}
                selected={date === selectedDay}
                onPick={() => props.select({ day: date })}
              />
            ) : (
              <span key={`blank${i}`} />
            ),
          )}
        </div>
      ))}
      <Legend />
      <p class="muted note">Striped days have no strap data. Small numbers are the day's steps.</p>
    </div>
  );
}

function MonthDay(props: {
  date: string;
  day: ActivityDayView | undefined;
  today: boolean;
  selected: boolean;
  onPick: () => void;
}) {
  const { day } = props;
  const workouts = day?.workouts.filter((w) => w.status !== "dismissed") ?? [];
  const walkMin = day?.walks.reduce((sum, w) => sum + w.minutes, 0) ?? 0;
  return (
    <button
      type="button"
      class={`month-day${day ? "" : " no-data"}${props.today ? " today" : ""}`}
      aria-pressed={props.selected}
      aria-label={`${shortDate(props.date)}${day ? "" : ", no strap data"}`}
      onClick={props.onPick}
    >
      <span class="month-day-head">
        <span>{dayOfMonth(props.date)}</span>
        {day && <span class="muted">{day.steps.toLocaleString("en-US")}</span>}
      </span>
      <span class="month-day-marks">
        {workouts.map((w) => (
          <span key={w.name} class={`chip${w.status === "possible" ? " unsure" : ""}`}>
            {workoutName(w)} · {duration(w.minutes)}
          </span>
        ))}
        {walkMin > 0 && (
          <span class="chip walk">
            {day?.walks.length === 1 ? "Walk" : `${day?.walks.length} walks`} · {duration(walkMin)}
          </span>
        )}
      </span>
    </button>
  );
}

/** Active minutes per week, workouts under walks. Striped weeks have no strap data. */
function QuarterBars(props: Ctx & { start: string; end: string }) {
  const weeks = weeklyMinutes(props.days, props.start, props.end);
  const top = Math.max(180, ...weeks.map((w) => w.workoutMin + w.walkMin));
  const selectedWeek = "week" in props.selected ? props.selected.week : null;
  return (
    <figure class="quarter">
      <figcaption class="muted">Active minutes by week</figcaption>
      <div class="quarter-bars">
        {weeks.map((w) => (
          <button
            key={w.start}
            type="button"
            class={`quarter-week${w.hasData ? "" : " no-data"}`}
            aria-pressed={w.start === selectedWeek}
            aria-label={`Week of ${dayMonth(w.start)}${w.hasData ? `, ${duration(w.workoutMin + w.walkMin)}` : ", no strap data"}`}
            onClick={() => props.select({ week: w.start })}
          >
            <span class="bar walk" style={{ height: `${(w.walkMin / top) * 100}%` }} />
            <span class="bar" style={{ height: `${(w.workoutMin / top) * 100}%` }} />
          </button>
        ))}
      </div>
      <div class="quarter-labels muted">
        {weeks.map((w, i) => (
          <span key={w.start}>{i % 4 === 0 ? dayMonth(w.start) : ""}</span>
        ))}
      </div>
      <Legend />
    </figure>
  );
}

function Legend() {
  return (
    <div class="legend muted">
      <span>
        <i class="swatch" /> Workouts
      </span>
      <span>
        <i class="swatch walk" /> Walks
      </span>
    </div>
  );
}

interface SideProps extends Ctx {
  token: Token;
  today: string;
  onShowDay: (s: Selection) => void;
  /** After each render with content: a workout's comes once it has loaded. */
  onShown: () => void;
}

function Side(props: SideProps) {
  const s = props.selected;
  useEffect(() => {
    if (!("workout" in s)) {
      props.onShown();
    }
  });
  if ("workout" in s) {
    return <WorkoutPanel {...props} name={s.workout} />;
  }
  if ("week" in s) {
    const dates = datesFrom(s.week, addDays(s.week, 6)).filter((d) => d <= props.today);
    const t = totals(props.days.filter((d) => dates.includes(d.date)));
    return (
      <div class="panel">
        <div class="panel-head">
          <h2>Week of {dayMonth(s.week)}</h2>
          <span class="muted">{duration(t.workoutMin + t.walkMin)}</span>
        </div>
        <p class="muted">
          {t.workouts} workouts · {t.walks} walks · {t.steps.toLocaleString("en-US")} steps
        </p>
        {dates.map((date) => {
          const day = props.days.find((d) => d.date === date);
          return (
            <button
              key={date}
              type="button"
              class="row"
              onClick={() => props.onShowDay({ day: date })}
            >
              <span class="row-main">{shortDate(date)}</span>
              <span class="muted">{day ? summary(day) : "No strap data"}</span>
            </button>
          );
        })}
      </div>
    );
  }
  const day = props.days.find((d) => d.date === s.day);
  return (
    <div class="panel">
      <div class="panel-head">
        <h2>{shortDate(s.day)}</h2>
        {day && <span class="muted">{day.steps.toLocaleString("en-US")} steps</span>}
      </div>
      {day ? <Sessions {...props} day={day} /> : <p class="muted">No strap data for this day.</p>}
    </div>
  );
}

function summary(day: ActivityDayView): string {
  const parts = day.workouts.filter((w) => w.status !== "dismissed").map(workoutName);
  if (day.walks.length > 0) {
    parts.push(day.walks.length === 1 ? "1 walk" : `${day.walks.length} walks`);
  }
  return parts.length > 0 ? parts.join(" · ") : "No sessions";
}

/** A day's workouts and walks, with a lifting log shown on its session. */
function Sessions(props: Ctx & { day: ActivityDayView }) {
  const { day } = props;
  const rows = [
    ...day.workouts.map((w) => ({ at: w.start, el: <WorkoutRow key={w.name} {...props} w={w} /> })),
    ...day.walks.map((w) => ({
      at: w.start,
      el: (
        <div key={w.start} class="row static">
          <span class="act-dot walk" />
          <span class="row-main">
            Walk
            <span class="row-sub">
              {props.clock(w.start)}–{props.clock(w.end)} · {duration(w.minutes)} · {w.cadence} spm
            </span>
          </span>
          <span class="muted">{w.steps.toLocaleString("en-US")} steps</span>
        </div>
      ),
    })),
  ].sort((a, b) => a.at - b.at);
  if (rows.length === 0) {
    return <p class="muted">No walks or workouts.</p>;
  }
  return <div class="sessions">{rows.map((r) => r.el)}</div>;
}

function WorkoutRow(
  props: Ctx & { w: WorkoutView; day: ActivityDayView; children?: preact.ComponentChildren },
) {
  const { w, day } = props;
  const dismissed = w.status === "dismissed";
  const lifting = w.kind === "lifting" && day.lifting;
  const stat = lifting
    ? `${Math.round(day.lifting?.volumeLb ?? 0).toLocaleString("en-US")} lb`
    : `strain ${w.strain.toFixed(1)}`;
  return (
    <div class={`session${dismissed ? " dismissed" : ""}`}>
      <button type="button" class="row" onClick={() => props.select({ workout: w.name })}>
        <span
          class={`act-dot${w.status === "possible" ? " unsure" : ""}${dismissed ? " off" : ""}`}
        />
        <span class="row-main">
          {dismissed ? kindLabel(w.kind) : workoutName(w)}
          <span class="row-sub">
            {dismissed
              ? "Not a workout · hidden from your totals"
              : `${props.clock(w.start)}–${props.clock(w.end)} · ${duration(w.minutes)}${lifting ? ` · ${day.lifting?.sets} sets from your note` : ""}`}
          </span>
        </span>
        <span class="muted">{stat}</span>
      </button>
      {props.children}
    </div>
  );
}

/** What this was: asked of a possible workout, or after "Change", and undoable once answered. */
function Review(props: {
  w: WorkoutView;
  changing: boolean;
  onChange: () => void;
  onReview: (kind: string) => Promise<void>;
}) {
  const { w } = props;
  if (w.status === "dismissed") {
    return (
      <div class="review">
        <span class="muted">Saved as not a workout.</span>
        <button type="button" class="chip-button" onClick={() => props.onReview("")}>
          Undo
        </button>
      </div>
    );
  }
  if (w.status !== "possible" && !props.changing) {
    return (
      <div class="review quiet">
        <button type="button" class="link-button" onClick={props.onChange}>
          Not right?
        </button>
      </div>
    );
  }
  const guess = w.kind === "workout" ? REVIEW_CHOICES.filter((k) => k !== "workout") : [w.kind];
  const others = props.changing ? REVIEW_CHOICES.filter((k) => k !== w.kind) : guess;
  return (
    <div class="review">
      <span class="muted">What was this?</span>
      <div class="review-choices">
        {others.map((kind) => (
          <button
            key={kind}
            type="button"
            class="chip-button accent"
            onClick={() => props.onReview(kind)}
          >
            It was {kindLabel(kind).toLowerCase()}
          </button>
        ))}
        <button type="button" class="chip-button" onClick={() => props.onReview("none")}>
          Not a workout
        </button>
      </div>
    </div>
  );
}

function WorkoutPanel(props: SideProps & { name: string }) {
  const [detail, setDetail] = useState<WorkoutDetail | null>(null);
  const [changing, setChanging] = useState(false);
  const date = props.name.slice(5, 15);
  const day = props.days.find((d) => d.date === date);
  const listed = day?.workouts.find((w) => w.name === props.name);
  useEffect(() => {
    fetchWorkout(props.token, props.name).then(setDetail, () => setDetail(null));
  }, [props.token, props.name, listed?.status, listed?.kind]);
  useEffect(() => {
    if (detail) {
      props.onShown();
    }
  });

  if (!(detail && day && listed)) {
    return <p class="muted">Loading…</p>;
  }
  const w = { ...detail, kind: listed.kind, status: listed.status };
  return (
    <div class="panel">
      <button type="button" class="link-button back" onClick={() => props.onShowDay({ day: date })}>
        ‹ {shortDate(date)}
      </button>
      <div class="panel-head">
        <h2>{workoutName(w)}</h2>
        <span class="muted">
          {props.clock(w.start)}–{props.clock(w.end)}
        </span>
      </div>
      <div class="detail-stats">
        <Stat name="Duration" value={duration(w.minutes)} detail="" />
        <Stat
          name="Avg HR"
          value={String(Math.round(w.avgHr))}
          detail={`max ${Math.round(w.maxHr)}`}
        />
        <Stat name="Strain" value={w.strain.toFixed(1)} detail="" />
      </div>
      <HeartRateChart detail={w} clock={props.clock} />
      {w.sets.length > 0 && <SetTable sets={w.sets} clock={props.clock} />}
      <WorkoutRow {...props} w={listed} day={day}>
        <Review
          w={listed}
          changing={changing}
          onChange={() => setChanging(true)}
          onReview={async (kind) => {
            setChanging(false);
            await props.review(listed.name, kind);
          }}
        />
      </WorkoutRow>
    </div>
  );
}

/**
 * HR every 15 seconds, with the session shaded and each matched set as a band. The SVG stretches
 * to the figure's width, so the bpm scale and times are HTML and stay readable on a phone.
 */
function HeartRateChart({
  detail,
  clock,
}: {
  detail: WorkoutDetail;
  clock: (ms: number) => string;
}) {
  const W = 600;
  const H = 180;
  const span = detail.heartRate.length * 15_000;
  const x = (ms: number) => ((ms - detail.heartRateStart) / span) * W;
  const known = detail.heartRate.filter((b) => b > 0);
  const lo = Math.min(...known, 60) - 5;
  const hi = Math.max(...known, 120) + 5;
  const y = (bpm: number) => H - ((bpm - lo) / (hi - lo)) * H;
  const lines = heartRateLines(detail.heartRate, detail.heartRateStart, x, y);
  const ticks = heartRateTicks(lo, hi);
  return (
    <figure class="hr-chart">
      <div class="hr-plot">
        <svg
          viewBox={`0 0 ${W} ${H}`}
          preserveAspectRatio="none"
          role="img"
          aria-label={`Heart rate from ${clock(detail.heartRateStart)} to ${clock(detail.heartRateStart + span)}, peaking at ${Math.max(...known, 0)} bpm`}
        >
          <rect
            x={x(detail.start)}
            y={0}
            width={x(detail.end) - x(detail.start)}
            height={H}
            class="session-shade"
          />
          <SetBands sets={detail.sets} x={x} height={H} />
          {ticks.map((bpm) => (
            <line key={bpm} x1={0} x2={W} y1={y(bpm)} y2={y(bpm)} class="hr-grid" />
          ))}
          {lines.map((points) => (
            <polyline key={points} points={points} class="hr-line" />
          ))}
        </svg>
        {ticks.map((bpm) => (
          <span key={bpm} class="hr-tick" style={{ top: `${(y(bpm) / H) * 100}%` }} aria-hidden>
            {bpm}
          </span>
        ))}
      </div>
      <div class="hr-times muted" aria-hidden>
        <span>bpm</span>
        <span>{clock(detail.heartRateStart)}</span>
        <span>{clock(detail.heartRateStart + span)}</span>
      </div>
    </figure>
  );
}

/** Each matched set as a band from its start to its HR peak, in its exercise's colour. */
function SetBands(props: {
  sets: WorkoutDetail["sets"];
  x: (ms: number) => number;
  height: number;
}) {
  const { x } = props;
  return props.sets.map((s, i) =>
    s.start && s.peak ? (
      <rect
        key={`${s.exercise}${i}`}
        x={x(s.start)}
        y={0}
        width={Math.max(2, x(s.peak) - x(s.start))}
        height={props.height}
        fill={EXERCISE_COLORS[s.exerciseIndex % EXERCISE_COLORS.length]}
        fill-opacity={s.warmUp ? 0.14 : 0.3}
      />
    ) : null,
  );
}

function SetTable({ sets, clock }: { sets: WorkoutDetail["sets"]; clock: (ms: number) => string }) {
  const exercises = [...new Set(sets.map((s) => s.exercise))];
  return (
    <div class="set-table">
      {exercises.map((name, e) => (
        <div key={name} class="exercise">
          <h3 class="act-heading">
            <i class="swatch" style={{ background: EXERCISE_COLORS[e % EXERCISE_COLORS.length] }} />
            {name}
          </h3>
          {sets
            .filter((s) => s.exercise === name)
            .map((s, i) => (
              <SetRow key={`${name}${i}`} set={s} clock={clock} />
            ))}
        </div>
      ))}
    </div>
  );
}

/** One set: its load, when its climb peaked, and how high. */
function SetRow({ set, clock }: { set: SetView; clock: (ms: number) => string }) {
  const load = set.weight === null ? "Bodyweight" : `${set.weight} ${set.unit}`;
  return (
    <div class={`set${set.warmUp ? " warm" : ""}`}>
      <span>
        {load} × {set.reps}
        {set.warmUp && <span class="muted"> warm-up</span>}
      </span>
      <span class="muted">{set.peak ? clock(set.peak) : "–"}</span>
      <span>{set.peakHr ? `${Math.round(set.peakHr)} bpm` : ""}</span>
    </div>
  );
}
