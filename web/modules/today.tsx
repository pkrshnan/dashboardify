// Today, the home screen: focus, then calendar and tasks, then health trends, all from the home
// view the shell loads. Day or Week is the address's `?view=week`.

import { useRef, useState } from "preact/hooks";
import type { CaptureHints } from "../../src/home/calendar";
import type { HomeView } from "../../src/home/types";
import {
  capture,
  completeTask,
  deleteEvent,
  deleteTask,
  randomKey,
  reopenTask,
  type Token,
} from "../api";
import { Calendar } from "../components/calendar";
import { Capture } from "../components/capture";
import { EventPanel } from "../components/event-panel";
import { Focus } from "../components/focus";
import { Health } from "../components/health";
import { TaskList } from "../components/task-list";
import { type Pending, pendingEvent, withPending } from "../lib/capture";
import { NIGHT_ROWS } from "../lib/night";
import { href } from "../lib/router";
import { navigate, setQuery } from "../lib/use-route";
import { useApp } from "./context";
import type { LoadedHome, Module, PageProps } from "./types";

export const today: Module = {
  id: "today",
  title: "Today",
  icon: "today",
  path: "/",
  key: "t",
  nav: { group: 1, phone: "tab" },
  needsHome: true,
  view: TodayPage,
};

function TodayPage({ route, home }: PageProps) {
  // The shell shows a module with needsHome only once the home view is loaded.
  return home ? <HomeScreen home={home} query={route.query} /> : null;
}

function HomeScreen({ home, query }: { home: LoadedHome; query: Record<string, string> }) {
  const week = query.view === "week";
  const { view, now, load } = home;
  const { token, isPhone } = useApp();
  const { ticked, complete, reopen } = useTicks(token, load);
  const [pending, setPending] = useState<Pending[]>([]);
  const [panel, openEvent] = useEventPanel(token, view.timeZone, load);
  const done = new Set([...ticked].filter(([, d]) => d).map(([id]) => id));
  const capture = (
    <HomeCapture
      token={token}
      timeZone={view.timeZone}
      hints={view.captureHints}
      isPhone={isPhone}
      reload={load}
      onPending={setPending}
    />
  );
  const tasks = <TaskList groups={view.tasks} done={done} onComplete={complete} />;
  return (
    <main class="home">
      <Focus view={view} now={now} />
      <Calendar
        view={withPending(withTicked(view, ticked), pending)}
        mode={week ? "week" : "day"}
        onMode={(next) => setQuery({ view: next === "week" ? "week" : "" })}
        nowMin={now.minutes}
        isPhone={isPhone}
        onComplete={complete}
        onReopen={reopen}
        onOpenEvent={openEvent}
        capture={capture}
        aside={isPhone ? undefined : tasks}
      />
      {isPhone && (
        <section class="section">
          <div class="section-head">
            <h2>Tasks</h2>
          </div>
          {tasks}
        </section>
      )}
      <HomeHealth home={home} />
      {panel}
    </main>
  );
}

/** Health trends. A sleep row goes to last night on the Health page, as a new history entry. */
function HomeHealth({ home }: { home: LoadedHome }) {
  const { view } = home;
  const { isPhone } = useApp();
  return (
    <Health
      metrics={view.health}
      date={view.date}
      sync={view.healthSync}
      timeZone={view.timeZone}
      isPhone={isPhone}
      opens={NIGHT_ROWS}
      onOpen={() => navigate(href("/health", { night: view.date }))}
    />
  );
}

/** The event panel for the event last tapped, and the function that opens one. */
function useEventPanel(token: Token, timeZone: string, load: () => Promise<void>) {
  const [opened, setOpened] = useState<string | null>(null);
  const panel = opened && (
    <EventPanel
      token={token}
      name={opened}
      timeZone={timeZone}
      onClose={() => setOpened(null)}
      onChanged={load}
    />
  );
  return [panel, setOpened] as const;
}

/**
 * The capture box. An event is drawn on the timeline at once ("Saving to iCloud…") until the
 * refresh after saving brings the real one. Undo deletes the event or the task again.
 */
function HomeCapture(props: {
  token: Token;
  timeZone: string;
  hints: CaptureHints | null;
  isPhone: boolean;
  reload: () => Promise<void>;
  onPending: (update: (pending: Pending[]) => Pending[]) => void;
}) {
  const { token, reload, onPending } = props;
  return (
    <Capture
      token={token}
      timeZone={props.timeZone}
      hints={props.hints}
      isPhone={props.isPhone}
      newRequestId={randomKey}
      onAdd={async (box, shown, requestId) => {
        const drawn = pendingEvent(shown, props.timeZone, requestId);
        if (drawn) {
          onPending((list) => [...list.filter((p) => p.key !== requestId), drawn]);
        }
        try {
          const result = await capture(token, {
            text: box.text,
            requestId,
            kind: box.override,
            calendar: box.calendar,
            place: shown.place,
          });
          await reload();
          return result;
        } finally {
          onPending((list) => list.filter((p) => p.key !== requestId));
        }
      }}
      onUndo={async (result) => {
        await (result.kind === "event"
          ? deleteEvent(token, result.name)
          : deleteTask(token, result.name));
        await reload();
      }}
    />
  );
}

/**
 * Ticks and unticks sent to the vault. Each shows at once and lasts until the refresh after it
 * brings the vault's answer. A task's requests wait for the one before, so a quick tick then
 * untick reaches the vault in that order.
 */
function useTicks(token: Token, load: () => Promise<void>) {
  const [ticked, setTicked] = useState(new Map<string, boolean>());
  const queue = useRef(new Map<string, Promise<void>>());
  const send = (id: string, done: boolean) => {
    setTicked((t) => new Map(t).set(id, done));
    const request = () => (done ? completeTask(token, id) : reopenTask(token, id));
    const last = queue.current.get(id) ?? Promise.resolve();
    const next: Promise<void> = last
      .then(request, request)
      .then(load, load)
      .then(() => {
        if (queue.current.get(id) !== next) {
          return;
        }
        queue.current.delete(id);
        setTicked((t) => {
          const left = new Map(t);
          left.delete(id);
          return left;
        });
      });
    queue.current.set(id, next);
  };
  return {
    ticked,
    complete: (id: string) => send(id, true),
    reopen: (id: string) => send(id, false),
  };
}

/** Reminders ticked or unticked in this session show that way before the refresh confirms it. */
function withTicked(view: HomeView, ticked: Map<string, boolean>): HomeView {
  const days = view.days.map((d) => ({
    ...d,
    reminders: d.reminders.map((r) => ({ ...r, done: ticked.get(r.id) ?? r.done })),
  }));
  return { ...view, days };
}
