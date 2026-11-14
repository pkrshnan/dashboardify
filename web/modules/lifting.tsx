// Lifting, at `#/lifting/<exercise>`: each exercise's history from the daily notes' Workouts
// (docs/lifting.md). Desktop shows the exercises, grouped by the day last done, beside the open
// one; the phone shows the list at `#/lifting` and one exercise at `#/lifting/<exercise>`.

import { useCallback, useEffect, useState } from "preact/hooks";
import {
  type ExerciseView,
  fetchExercise,
  fetchExercises,
  type SessionView,
  setRepRange,
  Unauthorized,
} from "../api";
import { type Segment, Segmented } from "../components/segmented";
import { WorkoutLog } from "../components/workout-log";
import {
  byLastDay,
  type ChartRange,
  dayMonth,
  inRange,
  matching,
  PLOT,
  progressLabel,
  type RepsChart,
  repsChart,
  restLabel,
  runTexts,
  type WeightChart,
  weightChart,
  workingText,
} from "../lib/lifting";
import { href } from "../lib/router";
import { setQuery } from "../lib/use-route";
import { useApp } from "./context";
import type { Module, PageProps } from "./types";

export const lifting: Module = {
  id: "lifting",
  title: "Lifting",
  icon: "lifting",
  path: "/lifting/:exercise?",
  key: "w",
  nav: { group: 3, phone: "more" },
  needsHome: true,
  view: LiftingPage,
};

const RANGES: Segment<ChartRange>[] = [
  { value: "3m", label: "3M" },
  { value: "1y", label: "1Y" },
  { value: "all", label: "All" },
];

function LiftingPage({ params, route, home }: PageProps) {
  const { isPhone } = useApp();
  const all = useExercises();
  if (!home) {
    return null;
  }
  if (params.exercise === "log") {
    return <WorkoutLog date={home.view.date} />;
  }
  const slug = params.exercise ?? (isPhone ? undefined : all?.[0]?.slug);
  const range = chartRange(route.query.range);
  const screen = slug && (
    <ExerciseScreen key={slug} slug={slug} range={range} today={home.view.date} back={isPhone} />
  );
  if (isPhone) {
    return <main class="lifting phone">{screen || <ExerciseIndex all={all} />}</main>;
  }
  return (
    <main class="lifting">
      <ExerciseIndex all={all} current={slug} />
      {screen}
    </main>
  );
}

/** `?range=`; three months when it is missing or unknown. */
export function chartRange(value: string | undefined): ChartRange {
  return value === "1y" || value === "all" ? value : "3m";
}

function useExercises(): ExerciseView[] | null {
  const { token, onUnauthorized } = useApp();
  const [all, setAll] = useState<ExerciseView[] | null>(null);
  useEffect(() => {
    fetchExercises(token)
      .then(setAll)
      .catch((error) => {
        if (error instanceof Unauthorized) {
          onUnauthorized(error.setup);
        }
      });
  }, [token, onUnauthorized]);
  return all;
}

function ExerciseIndex({ all, current }: { all: ExerciseView[] | null; current?: string }) {
  const [query, setQueryText] = useState("");
  const groups = byLastDay(matching(all ?? [], query));
  return (
    <nav class="lift-index" aria-label="Exercises">
      <div class="lift-index-head">
        <h1 class="lift-title">Lifting</h1>
        <a class="lift-log-link" href={href("/lifting/log")}>
          Log a workout
        </a>
      </div>
      <input
        class="lift-search"
        type="search"
        aria-label="Find an exercise"
        placeholder="Find an exercise"
        value={query}
        onInput={(e) => setQueryText((e.currentTarget as HTMLInputElement).value)}
      />
      {all?.length === 0 && <p class="muted">Nothing logged yet.</p>}
      {groups.map((group) => (
        <section key={group.date} class="lift-day">
          <h2 class="lift-day-label">{group.label}</h2>
          {group.exercises.map((e) => (
            <ExerciseRow key={e.slug} exercise={e} current={e.slug === current} />
          ))}
        </section>
      ))}
    </nav>
  );
}

function ExerciseRow({ exercise, current }: { exercise: ExerciseView; current: boolean }) {
  const last = exercise.sessions[0];
  const progress = last ? progressLabel(last.progress) : "";
  return (
    <a
      class="lift-row"
      href={href(`/lifting/${exercise.slug}`)}
      aria-current={current ? "page" : undefined}
    >
      <span class="lift-name">{exercise.title}</span>
      <span class="lift-sets">
        {last ? workingText(last.sets, exercise.unit) : ""}
        {progress.startsWith("↑") && <span class="lift-up"> {progress}</span>}
      </span>
    </a>
  );
}

function ExerciseScreen(props: { slug: string; range: ChartRange; today: string; back: boolean }) {
  const { token, onUnauthorized } = useApp();
  const [exercise, setExercise] = useState<ExerciseView | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(async () => {
    try {
      setExercise(await fetchExercise(token, props.slug));
    } catch (err) {
      if (err instanceof Unauthorized) {
        onUnauthorized(err.setup);
      } else {
        setError(err instanceof Error ? err.message : String(err));
      }
    }
  }, [token, props.slug, onUnauthorized]);
  useEffect(() => {
    load();
  }, [load]);
  if (!exercise) {
    return <section class="lift-screen">{error && <p class="muted">{error}</p>}</section>;
  }
  const first = exercise.sessions[exercise.sessions.length - 1];
  const count = exercise.sessions.length;
  return (
    <section class="lift-screen">
      {props.back && (
        <a class="lift-back" href={href("/lifting")}>
          ‹ Lifting
        </a>
      )}
      <header class="lift-head">
        <h2 class="lift-name-head">{exercise.title}</h2>
        <span class="muted">
          {count} {count === 1 ? "session" : "sessions"}
          {first && count > 1 ? ` since ${dayMonth(first.date)}` : ""}
        </span>
        {exercise.path && <span class="lift-path">{exercise.path}</span>}
      </header>
      <NextTime exercise={exercise} onChanged={setExercise} />
      {exercise.sessions[0] && <LastSession exercise={exercise} session={exercise.sessions[0]} />}
      <Progress exercise={exercise} range={props.range} today={props.today} />
      <Records exercise={exercise} />
      <History exercise={exercise} />
    </section>
  );
}

function NextTime(props: { exercise: ExerciseView; onChanged: (e: ExerciseView) => void }) {
  const { exercise } = props;
  const [editing, setEditing] = useState(false);
  const last = exercise.sessions[0];
  if (!exercise.next) {
    return null;
  }
  const { low, high, step } = exercise.range;
  return (
    <div class="lift-next">
      <span class="muted">Next time</span>
      <span class="lift-next-sets">{workingText(exercise.next.sets, exercise.unit)}</span>
      {last && <span class="lift-next-why">Last: {workingText(last.sets, exercise.unit)}</span>}
      {editing ? (
        <RangeForm
          exercise={exercise}
          onDone={(changed) => {
            setEditing(false);
            if (changed) {
              props.onChanged(changed);
            }
          }}
        />
      ) : (
        <button type="button" class="lift-range" onClick={() => setEditing(true)}>
          {low}–{high} reps · +{step} {exercise.unit}
        </button>
      )}
    </div>
  );
}

/** Low, high and step; Return or Save writes them to the exercise's note. */
function RangeForm(props: { exercise: ExerciseView; onDone: (e: ExerciseView | null) => void }) {
  const { token } = useApp();
  const [error, setError] = useState<string | null>(null);
  const { low, high, step } = props.exercise.range;
  const submit = async (event: Event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const value = (name: string) =>
      Number((form.elements.namedItem(name) as HTMLInputElement | null)?.value);
    try {
      const range = { low: value("low"), high: value("high"), step: value("step") };
      props.onDone(await setRepRange(token, props.exercise.slug, range));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };
  return (
    <form class="lift-range-form" onSubmit={submit}>
      <label>
        Reps{" "}
        <input
          name="low"
          aria-label="Fewest reps"
          type="number"
          min="1"
          defaultValue={String(low)}
        />
      </label>
      <label>
        to{" "}
        <input
          name="high"
          aria-label="Most reps"
          type="number"
          min="1"
          defaultValue={String(high)}
        />
      </label>
      <label>
        +
        <input
          name="step"
          aria-label="Weight step"
          type="number"
          min="0.5"
          step="0.5"
          defaultValue={String(step)}
        />{" "}
        {props.exercise.unit}
      </label>
      <button type="submit" class="lift-form-button">
        Save
      </button>
      <button type="button" class="lift-form-button" onClick={() => props.onDone(null)}>
        Cancel
      </button>
      {error && <span class="muted">{error}</span>}
    </form>
  );
}

function LastSession({ exercise, session }: { exercise: ExerciseView; session: SessionView }) {
  const progress = progressLabel(session.progress);
  const facts = [
    session.est1rm === null ? null : `est. 1RM ${Math.round(session.est1rm)} ${exercise.unit}`,
    session.restSeconds === null ? null : `rest ${restLabel(session.restSeconds)}`,
    session.peakHr === null ? null : `peak ${session.peakHr} bpm`,
  ].filter((f): f is string => f !== null);
  return (
    <div class="lift-last">
      <span class="muted">Last · {dayMonth(session.date)}</span>
      {runTexts(session.sets, exercise.unit).map((run) => (
        <span key={run.text} class={run.warmUp ? "lift-chip warm" : "lift-chip"}>
          {run.text}
        </span>
      ))}
      {progress && <span class={progress.startsWith("↑") ? "lift-up" : "muted"}>{progress}</span>}
      <span class="lift-facts muted">{facts.join(" · ")}</span>
      {session.peakHr !== null && (
        <a class="lift-hr" href={href("/activity")}>
          HR on Activity ›
        </a>
      )}
    </div>
  );
}

function Progress(props: { exercise: ExerciseView; range: ChartRange; today: string }) {
  const shown = inRange(props.exercise.sessions, props.range, props.today);
  const weight = weightChart(shown);
  const reps = repsChart(shown, props.exercise.unit);
  return (
    <div class="lift-progress">
      <div class="lift-progress-head">
        <h3 class="lift-progress-title">Progress</h3>
        <Segmented
          label="Range"
          segments={RANGES}
          value={props.range}
          onChange={(range) => setQuery({ range: range === "3m" ? "" : range })}
        />
      </div>
      <div class="lift-charts">
        {weight && <WeightFigure chart={weight} />}
        {reps && <RepsFigure chart={reps} />}
      </div>
    </div>
  );
}

function WeightFigure({ chart: weight }: { chart: WeightChart }) {
  return (
    <figure>
      <figcaption>
        Weight <span class="lift-key top">— top set</span>
        <span class="lift-key est">— est. 1RM</span>
      </figcaption>
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label="Top weight and estimated one-rep max over time"
      >
        {weight.ticks.map((t) => (
          <g key={t.label}>
            <path class="lift-grid" d={`M${PLOT.left} ${t.y}H${PLOT.width}`} />
            <text class="lift-axis" x="0" y={t.y + 4}>
              {t.label}
            </text>
          </g>
        ))}
        <polyline class="lift-est" points={weight.estimate} />
        <path class="lift-step" d={weight.steps} />
        {weight.dots.map((d) => (
          <circle
            key={`${d.x}`}
            class={d.heaviest ? "lift-dot heaviest" : "lift-dot"}
            cx={d.x}
            cy={d.y}
            r={d.heaviest ? 5 : 3.5}
          />
        ))}
        {weight.months.map((m) => (
          <text key={m.label + m.x} class="lift-axis" x={m.x} y={PLOT.height - 4}>
            {m.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function RepsFigure({ chart: reps }: { chart: RepsChart }) {
  return (
    <figure>
      <figcaption>Reps at top weight</figcaption>
      <svg
        viewBox={`0 0 ${PLOT.width} ${PLOT.height}`}
        role="img"
        aria-label="Reps at the top weight per session, grouped by weight"
      >
        {reps.bars.map((b) => (
          <rect
            key={`${b.x}`}
            class={`lift-bar shade-${b.shade}`}
            x={b.x - b.width / 2}
            y={b.y}
            width={b.width}
            height={b.height}
            rx="3"
          />
        ))}
        {reps.dividers.map((x) => (
          <path key={x} class="lift-divider" d={`M${x} 20V${PLOT.height - PLOT.bottom}`} />
        ))}
        {reps.groups.map((g) => (
          <text key={g.label + g.x} class="lift-axis" x={g.x} y="12" text-anchor="middle">
            {g.label}
          </text>
        ))}
        {reps.months.map((m) => (
          <text key={m.label + m.x} class="lift-axis" x={m.x} y={PLOT.height - 4}>
            {m.label}
          </text>
        ))}
      </svg>
    </figure>
  );
}

function Records({ exercise }: { exercise: ExerciseView }) {
  const { heaviest, est1rm, atTop } = exercise.records;
  const top = exercise.sessions[0]?.topWeight ?? null;
  const unit = exercise.unit;
  // Reps only: the weight is in the label.
  const atTopSets = atTop?.reps.map((reps) => ({ weight: null, reps, warmUp: false })) ?? [];
  return (
    <dl class="lift-records">
      {heaviest && (
        <div>
          <dt>Heaviest</dt>
          <dd>
            {heaviest.value} {unit} <span class="muted">{dayMonth(heaviest.date)}</span>
          </dd>
        </div>
      )}
      {est1rm && (
        <div>
          <dt>Best est. 1RM</dt>
          <dd>
            {Math.round(est1rm.value)} {unit} <span class="muted">{dayMonth(est1rm.date)}</span>
          </dd>
        </div>
      )}
      {atTop && (
        <div>
          <dt>{top === null ? "Most reps" : `Best at ${top} ${unit}`}</dt>
          <dd>
            {workingText(atTopSets, unit)} <span class="muted">{dayMonth(atTop.date)}</span>
          </dd>
        </div>
      )}
    </dl>
  );
}

const RECORD_TAGS: Record<string, string> = {
  heaviest: "heaviest",
  est_one_rep_max: "best est. 1RM",
};

function History({ exercise }: { exercise: ExerciseView }) {
  return (
    <div class="lift-history">
      <table>
        <thead>
          <tr>
            <th>Day</th>
            <th>Sets</th>
            <th class="num">Est. 1RM</th>
            <th class="num">Rest</th>
            <th class="num">Peak HR</th>
            <th class="num">vs last</th>
          </tr>
        </thead>
        <tbody>
          {exercise.sessions.map((s) => (
            <tr key={s.date}>
              <td>{dayMonth(s.date)}</td>
              <td>
                {runTexts(s.sets, exercise.unit).map((run, i) => (
                  <span key={run.text} class={run.warmUp ? "muted" : undefined}>
                    {i > 0 ? " · " : ""}
                    {run.text}
                  </span>
                ))}
                {s.records
                  .filter((r) => RECORD_TAGS[r])
                  .map((r) => (
                    <span key={r} class="lift-tag">
                      {RECORD_TAGS[r]}
                    </span>
                  ))}
              </td>
              <td class="num">{s.est1rm === null ? "" : Math.round(s.est1rm)}</td>
              <td class="num">{s.restSeconds === null ? "" : restLabel(s.restSeconds)}</td>
              <td class="num">{s.peakHr ?? ""}</td>
              <td
                class={s.progress.startsWith("w") || s.progress === "reps" ? "num lift-up" : "num"}
              >
                {progressLabel(s.progress)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
