// The log screen, at `#/lifting/log` (docs/lifting.md): today's exercises, each opened with next
// time's sets filled in. A set counts unless it's removed, so there is no tick: every change is
// written to the day's note at once, one exercise at a time, in the order made. Removing a set or
// an exercise offers Undo. Desktop removes with ×; the phone swipes a set left and long-presses an
// exercise.

import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import {
  type ExerciseView,
  fetchExercises,
  fetchWorkoutLog,
  removeLoggedExercise,
  saveLoggedExercise,
  Unauthorized,
  type WorkoutLogView,
  type WorkSetView,
} from "../api";
import { weekdayLabel, workingText } from "../lib/lifting";
import { href } from "../lib/router";
import {
  addChoices,
  addSet,
  type Draft,
  draftsOf,
  newDraft,
  removeSet,
  setLabels,
  setWeight,
  stepReps,
  stepWeight,
  toggleWarmUp,
  toSave,
  usuallyNext,
  weightStep,
} from "../lib/workout-log";
import { useApp } from "../modules/context";

interface Undo {
  label: string;
  restore: () => void;
}

/** How long Undo stays up. */
const UNDO_MS = 8000;
/** Holding an exercise this long opens its menu on the phone. */
const LONG_PRESS_MS = 500;
/** A swipe this far left shows Delete; twice as far deletes. */
const SWIPE_OPEN = 74;

export function WorkoutLog(props: { date: string }) {
  const { isPhone } = useApp();
  const log = useLog(props.date);
  const exercises = useHistoryBefore(props.date);
  const [current, setCurrent] = useState<string | undefined>(undefined);
  const [undo, setUndo] = useState<Undo | null>(null);
  if (!log.drafts) {
    return <main class={isPhone ? "lifting phone" : "lifting"} />;
  }
  const drafts = log.drafts;
  const active = drafts.find((d) => d.slug === current) ?? drafts[drafts.length - 1];
  const actions: Actions = {
    select: setCurrent,
    add: (title, exercise) => {
      const draft = newDraft(title, exercise);
      log.save(draft);
      setCurrent(draft.slug);
    },
    removeExercise: (draft) => {
      log.remove(draft.slug);
      setUndo({ label: `Removed ${draft.title}`, restore: () => log.save(draft) });
    },
    change: (draft) => log.save(draft),
    removeSet: (draft, i) => {
      log.save({ ...draft, sets: removeSet(draft.sets, i) });
      const label = setLabels(draft.sets)[i] ?? "";
      setUndo({ label: `Removed set ${label}`, restore: () => log.save(draft) });
    },
  };
  const shared = { ...props, exercises, drafts, active, actions, error: log.error };
  return (
    <main class={isPhone ? "lifting phone log" : "lifting log"}>
      {isPhone ? <PhoneLog {...shared} /> : <DesktopLog {...shared} />}
      {undo && <UndoToast undo={undo} onDone={() => setUndo(null)} />}
    </main>
  );
}

interface Actions {
  select: (slug: string) => void;
  add: (title: string, exercise: ExerciseView | undefined) => void;
  removeExercise: (draft: Draft) => void;
  change: (draft: Draft) => void;
  removeSet: (draft: Draft, i: number) => void;
}

interface LogProps {
  date: string;
  exercises: ExerciseView[];
  drafts: Draft[];
  active: Draft | undefined;
  actions: Actions;
  error: string | null;
}

/** Each exercise as it stood before `date`, so next time doesn't count what's logged today. */
function useHistoryBefore(date: string): ExerciseView[] {
  const { token } = useApp();
  const [exercises, setExercises] = useState<ExerciseView[]>([]);
  useEffect(() => {
    fetchExercises(token, date)
      .then(setExercises)
      .catch(() => undefined);
  }, [token, date]);
  return exercises;
}

/** The day's log, and writes queued so they reach the note in order with the latest etag. */
function useLog(date: string) {
  const { token, onUnauthorized } = useApp();
  const [drafts, setDrafts] = useState<Draft[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const etag = useRef("");
  const queue = useRef<Promise<void>>(Promise.resolve());
  const reload = useCallback(async () => {
    const log = await fetchWorkoutLog(token, date);
    etag.current = log.etag;
    setDrafts(draftsOf(log));
  }, [token, date]);
  useEffect(() => {
    reload().catch((err) => {
      if (err instanceof Unauthorized) {
        onUnauthorized(err.setup);
      }
    });
  }, [reload, onUnauthorized]);
  const run = (write: (etag: string) => Promise<WorkoutLogView>) => {
    queue.current = queue.current.then(async () => {
      try {
        etag.current = (await write(etag.current)).etag;
        setError(null);
      } catch (err) {
        // Most likely edited in Obsidian meanwhile: show the note as it is now.
        setError(err instanceof Error ? err.message : String(err));
        await reload().catch(() => undefined);
      }
    });
  };
  const save = (draft: Draft) => {
    setDrafts((all) => upsert(all ?? [], draft));
    run((tag) => saveLoggedExercise(token, date, { ...draft, sets: toSave(draft.sets) }, tag));
  };
  const remove = (slug: string) => {
    setDrafts((all) => (all ?? []).filter((d) => d.slug !== slug));
    run((tag) => removeLoggedExercise(token, date, slug, tag));
  };
  return { drafts, error, save, remove };
}

function upsert(drafts: Draft[], draft: Draft): Draft[] {
  return drafts.some((d) => d.slug === draft.slug)
    ? drafts.map((d) => (d.slug === draft.slug ? draft : d))
    : [...drafts, draft];
}

function DesktopLog(props: LogProps) {
  const { drafts, active, actions } = props;
  return (
    <>
      <nav class="lift-index" aria-label="Today's workout">
        <a class="lift-back side" href={href("/lifting")}>
          ‹ Lifting
        </a>
        <div class="lift-index-head">
          <h1 class="lift-title">Today</h1>
        </div>
        <span class="lift-date muted">{weekdayLabel(props.date)}</span>
        {drafts.map((d) => (
          <div key={d.slug} class="lift-today">
            <button
              type="button"
              class="lift-row"
              aria-current={d.slug === active?.slug ? "true" : undefined}
              onClick={() => actions.select(d.slug)}
            >
              <span class="lift-name">{d.title}</span>
              <span class="lift-sets">{workingText(toSave(d.sets), d.unit)}</span>
            </button>
            <button
              type="button"
              class="lift-x"
              aria-label={`Remove ${d.title} from today`}
              onClick={() => actions.removeExercise(d)}
            >
              ×
            </button>
          </div>
        ))}
        <AddExercise {...props} />
      </nav>
      <section class="lift-screen">
        {props.error && <p class="lift-error">{props.error}</p>}
        {active ? (
          <Editor {...props} draft={active} />
        ) : (
          <p class="muted">Add an exercise to start.</p>
        )}
      </section>
    </>
  );
}

function PhoneLog(props: LogProps) {
  const { drafts, active } = props;
  const [adding, setAdding] = useState(drafts.length === 0);
  const add: Actions["add"] = (title, exercise) => {
    props.actions.add(title, exercise);
    setAdding(false);
  };
  return (
    <section class="lift-screen">
      <div class="lift-log-top">
        <a class="lift-back" href={href("/lifting")}>
          ‹ Lifting
        </a>
        <span class="muted">{weekdayLabel(props.date)}</span>
      </div>
      <ExerciseBar {...props} onAdd={() => setAdding(true)} />
      {props.error && <p class="lift-error">{props.error}</p>}
      {adding || !active ? (
        <AddExercise {...props} actions={{ ...props.actions, add }} />
      ) : (
        <Editor {...props} draft={active} />
      )}
    </section>
  );
}

/** Today's exercises side by side; it scrolls and keeps the current one in view. */
function ExerciseBar(props: LogProps & { onAdd: () => void }) {
  const [menu, setMenu] = useState<string | null>(null);
  const current = useRef<HTMLButtonElement | null>(null);
  useEffect(() => {
    current.current?.scrollIntoView?.({ inline: "end", block: "nearest" });
  }, [props.active?.slug]);
  return (
    <div class="lift-bar-wrap">
      <div class="lift-pills">
        {props.drafts.map((d) => (
          <Pill
            key={d.slug}
            draft={d}
            current={d.slug === props.active?.slug}
            buttonRef={d.slug === props.active?.slug ? current : undefined}
            onSelect={() => props.actions.select(d.slug)}
            onMenu={() => setMenu(d.slug)}
          />
        ))}
        <button
          type="button"
          class="lift-pill add"
          aria-label="Add an exercise"
          onClick={props.onAdd}
        >
          +
        </button>
      </div>
      {menu && (
        <ExerciseMenu
          draft={props.drafts.find((d) => d.slug === menu)}
          onRemove={(d) => {
            setMenu(null);
            props.actions.removeExercise(d);
          }}
          onClose={() => setMenu(null)}
        />
      )}
    </div>
  );
}

function Pill(props: {
  draft: Draft;
  current: boolean;
  buttonRef?: { current: HTMLButtonElement | null };
  onSelect: () => void;
  onMenu: () => void;
}) {
  const press = useLongPress(props.onMenu);
  return (
    <button
      type="button"
      ref={props.buttonRef}
      class={props.current ? "lift-pill current" : "lift-pill"}
      aria-current={props.current ? "true" : undefined}
      onClick={() => press.wasLong() || props.onSelect()}
      onContextMenu={(e) => {
        e.preventDefault();
        props.onMenu();
      }}
      {...press.handlers}
    >
      {props.draft.title}
    </button>
  );
}

/** The long-press menu, as iOS shows it: the destructive choice in red. */
function ExerciseMenu(props: {
  draft: Draft | undefined;
  onRemove: (d: Draft) => void;
  onClose: () => void;
}) {
  const { draft } = props;
  if (!draft) {
    return null;
  }
  return (
    <div class="lift-menu" role="menu" aria-label={draft.title}>
      <button
        type="button"
        role="menuitem"
        class="lift-menu-item danger"
        onClick={() => props.onRemove(draft)}
      >
        Remove from workout
      </button>
      <button type="button" role="menuitem" class="lift-menu-item" onClick={props.onClose}>
        Cancel
      </button>
    </div>
  );
}

function useLongPress(onLong: () => void) {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fired = useRef(false);
  const clear = () => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  };
  return {
    wasLong: () => {
      const long = fired.current;
      fired.current = false;
      return long;
    },
    handlers: {
      onPointerDown: () => {
        fired.current = false;
        timer.current = setTimeout(() => {
          fired.current = true;
          onLong();
        }, LONG_PRESS_MS);
      },
      onPointerUp: clear,
      onPointerLeave: clear,
    },
  };
}

/** Search the history, or name a new exercise; "Usually next" offers the rest of that session. */
function AddExercise(props: LogProps) {
  const [query, setQuery] = useState("");
  const logged = props.drafts.map((d) => d.slug);
  const { matches, newTitle } = addChoices(props.exercises, query, logged);
  const next = usuallyNext(props.active?.slug, props.exercises, logged);
  const add = (title: string, exercise?: ExerciseView) => {
    props.actions.add(title, exercise);
    setQuery("");
  };
  return (
    <div class="lift-add">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          const first = matches[0];
          if (first) {
            add(first.title, first);
          } else if (newTitle) {
            add(newTitle);
          }
        }}
      >
        <input
          class="lift-search"
          aria-label="Add an exercise"
          placeholder="Add an exercise"
          value={query}
          onInput={(e) => setQuery((e.currentTarget as HTMLInputElement).value)}
        />
      </form>
      {matches.map((e) => (
        <Choice key={e.slug} exercise={e} onAdd={() => add(e.title, e)} />
      ))}
      {newTitle && (
        <button type="button" class="lift-choice" onClick={() => add(newTitle)}>
          <span class="lift-name">Add “{newTitle}”</span>
          <span class="lift-sets">New exercise</span>
        </button>
      )}
      {query === "" && next.length > 0 && (
        <>
          <span class="lift-day-label">Usually next</span>
          {next.map((e) => (
            <Choice key={e.slug} exercise={e} onAdd={() => add(e.title, e)} />
          ))}
        </>
      )}
    </div>
  );
}

function Choice({ exercise, onAdd }: { exercise: ExerciseView; onAdd: () => void }) {
  return (
    <button type="button" class="lift-choice" onClick={onAdd}>
      <span class="lift-name">{exercise.title}</span>
      <span class="lift-sets">
        {exercise.next ? workingText(exercise.next.sets, exercise.unit) : ""}
      </span>
    </button>
  );
}

function Editor(props: LogProps & { draft: Draft }) {
  const { draft, actions } = props;
  const history = props.exercises.find((e) => e.slug === draft.slug);
  const change = (sets: WorkSetView[]) => actions.change({ ...draft, sets });
  const labels = setLabels(draft.sets);
  return (
    <div class="lift-editor">
      <header class="lift-head">
        <h2 class="lift-name-head">{draft.title}</h2>
        {history && (
          <a class="lift-path" href={href(`/lifting/${draft.slug}`)}>
            All sessions ›
          </a>
        )}
      </header>
      {history?.next && (
        <div class="lift-next">
          <span class="lift-next-line">{workingText(history.next.sets, history.unit)}</span>
          {history.sessions[0] && (
            <span class="lift-next-why">
              Last: {workingText(history.sessions[0].sets, history.unit)}
            </span>
          )}
        </div>
      )}
      <div class="lift-sets-table">
        {draft.sets.map((set, i) => (
          <SetRow
            key={i}
            label={labels[i] ?? ""}
            set={set}
            unit={draft.unit}
            onChange={(sets) => change(sets(draft.sets, i))}
            onRemove={() => actions.removeSet(draft, i)}
          />
        ))}
        <button type="button" class="lift-add-set" onClick={() => change(addSet(draft.sets))}>
          + Set
        </button>
      </div>
    </div>
  );
}

type Edit = (sets: WorkSetView[], i: number) => WorkSetView[];

function SetRow(props: {
  label: string;
  set: WorkSetView;
  unit: "lb" | "kg";
  onChange: (edit: Edit) => void;
  onRemove: () => void;
}) {
  const { isPhone } = useApp();
  const { set, unit, onChange } = props;
  const step = weightStep(unit);
  const row = (
    <div class={set.warmUp ? "lift-set warm" : "lift-set"}>
      <button
        type="button"
        class={set.warmUp ? "lift-setn w" : "lift-setn"}
        aria-label={
          set.warmUp ? "Warm-up; make it a working set" : `Set ${props.label}; make it a warm-up`
        }
        onClick={() => onChange(toggleWarmUp)}
      >
        {props.label}
      </button>
      <Stepper
        label="weight"
        value={set.weight === null ? "" : String(set.weight)}
        suffix={unit}
        onStep={(by) => onChange((s, i) => stepWeight(s, i, by * step))}
        onType={(v) => onChange((s, i) => setWeight(s, i, v === "" ? null : Number(v)))}
      />
      <Stepper
        label="reps"
        value={String(set.reps)}
        onStep={(by) => onChange((s, i) => stepReps(s, i, by))}
      />
      {!isPhone && (
        <button
          type="button"
          class="lift-x"
          aria-label={`Remove set ${props.label}`}
          onClick={props.onRemove}
        >
          ×
        </button>
      )}
    </div>
  );
  return isPhone ? <SwipeToDelete onDelete={props.onRemove}>{row}</SwipeToDelete> : row;
}

function Stepper(props: {
  label: string;
  value: string;
  suffix?: string;
  onStep: (by: 1 | -1) => void;
  onType?: (value: string) => void;
}) {
  return (
    <div class="lift-stepper">
      <button
        type="button"
        class="lift-step-btn"
        aria-label={`Less ${props.label}`}
        onClick={() => props.onStep(-1)}
      >
        −
      </button>
      {props.onType ? (
        <input
          class="lift-step-value"
          aria-label={props.label}
          inputMode="decimal"
          value={props.value}
          placeholder="–"
          onChange={(e) => props.onType?.((e.currentTarget as HTMLInputElement).value.trim())}
        />
      ) : (
        <output class="lift-step-value" aria-label={props.label}>
          {props.value}
        </output>
      )}
      {props.suffix && <span class="lift-unit">{props.suffix}</span>}
      <button
        type="button"
        class="lift-step-btn"
        aria-label={`More ${props.label}`}
        onClick={() => props.onStep(1)}
      >
        +
      </button>
    </div>
  );
}

/** iOS's swipe: left shows Delete, all the way deletes. */
function SwipeToDelete(props: { onDelete: () => void; children: preact.ComponentChildren }) {
  const [offset, setOffset] = useState(0);
  const start = useRef<number | null>(null);
  const settle = () => {
    if (offset <= -2 * SWIPE_OPEN) {
      props.onDelete();
      setOffset(0);
    } else {
      setOffset(offset < -SWIPE_OPEN / 2 ? -SWIPE_OPEN : 0);
    }
    start.current = null;
  };
  return (
    <div class="lift-swipe">
      <button type="button" class="lift-delete" onClick={props.onDelete}>
        Delete
      </button>
      <div
        class="lift-swipe-row"
        style={{ transform: `translateX(${offset}px)` }}
        onPointerDown={(e) => {
          start.current = e.clientX - offset;
        }}
        onPointerMove={(e) => {
          if (start.current !== null) {
            setOffset(Math.min(0, e.clientX - start.current));
          }
        }}
        onPointerUp={settle}
        onPointerCancel={settle}
      >
        {props.children}
      </div>
    </div>
  );
}

function UndoToast({ undo, onDone }: { undo: Undo; onDone: () => void }) {
  useEffect(() => {
    const timer = setTimeout(onDone, UNDO_MS);
    return () => clearTimeout(timer);
  }, [undo, onDone]);
  return (
    <div class="lift-toast" role="status">
      {undo.label}
      <button
        type="button"
        class="lift-toast-undo"
        onClick={() => {
          undo.restore();
          onDone();
        }}
      >
        Undo
      </button>
    </div>
  );
}
