// The home screen: focus, then calendar and tasks, then health trends. It loads everything from
// GET /v1/home and refreshes every few minutes, when the tab comes back, and at midnight.

import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { CaptureHints } from "../src/home/calendar";
import type { HomeView } from "../src/home/types";
import {
  capture,
  completeTask,
  deleteEvent,
  deleteTask,
  fetchHome,
  randomKey,
  reopenTask,
  savedToken,
  saveToken,
  type Token,
  Unauthorized,
} from "./api";
import { Activity } from "./components/activity";
import { Calendar } from "./components/calendar";
import { Capture } from "./components/capture";
import { EventPanel } from "./components/event-panel";
import { Focus } from "./components/focus";
import { Health } from "./components/health";
import { SignIn } from "./components/sign-in";
import { TaskList } from "./components/task-list";
import { type Pending, pendingEvent, withPending } from "./lib/capture";
import { type Now, nowIn } from "./lib/clock";
import { sectionFromHash } from "./settings/sections";
import { Settings } from "./settings/settings";
import { tokenFromHash } from "./settings/sign-in-link";

const REFRESH_MS = 5 * 60_000;
const TICK_MS = 15_000;
const PHONE_QUERY = "(max-width: 899px)";

/** Straight to the home screen; the sign-in screen only when the server wants a token. */
function App() {
  const [token, setToken] = useState<Token>(tokenFromLink);
  const [signIn, setSignIn] = useState<"no" | "ask" | "failed" | "setup">("no");
  if (signIn !== "no") {
    return (
      <SignIn
        failed={signIn === "failed"}
        setup={signIn === "setup"}
        onToken={(t) => {
          saveToken(t);
          setToken(t);
          setSignIn("no");
        }}
      />
    );
  }
  const unauthorized = (setup: boolean) => {
    saveToken(null);
    if (setup) {
      setSignIn("setup");
    } else {
      setSignIn(token ? "failed" : "ask");
    }
    setToken(null);
  };
  return <Routes token={token} onUnauthorized={unauthorized} />;
}

/**
 * The saved token, or a new one from an Add device sign-in link (#token=…), which is saved and
 * then removed from the address bar so it doesn't stay in history.
 */
function tokenFromLink(): Token {
  const linked = tokenFromHash(window.location.hash);
  if (!linked) {
    return savedToken();
  }
  saveToken(linked);
  history.replaceState(null, "", window.location.pathname);
  return linked;
}

/** `#settings…` shows Settings; anything else, the home screen. */
function Routes(props: { token: Token; onUnauthorized: (setup: boolean) => void }) {
  const hash = useHash();
  const isPhone = useMedia(PHONE_QUERY);
  if (hash.startsWith("#settings")) {
    return <Settings {...props} section={sectionFromHash(hash)} isPhone={isPhone} />;
  }
  return <Home {...props} />;
}

/** Loads the home view, then shows the home screen or, at #activity, the Activity page. */
function Home({
  token,
  onUnauthorized,
}: {
  token: Token;
  onUnauthorized: (setup: boolean) => void;
}) {
  const { view, error, load } = useHome(token, onUnauthorized);
  const now = useNow(view?.timeZone);
  const isPhone = useMedia(PHONE_QUERY);
  const hash = useHash();

  if (!(view && now)) {
    return <p class="sign-in muted">{error ? "Can't reach the server." : ""}</p>;
  }
  if (hash === "#activity") {
    return (
      <Activity
        token={token}
        timeZone={view.timeZone}
        today={view.date}
        onUnauthorized={onUnauthorized}
      />
    );
  }
  return <HomeScreen view={view} now={now} isPhone={isPhone} token={token} load={load} />;
}

function HomeScreen(props: {
  view: HomeView;
  now: Now;
  isPhone: boolean;
  token: Token;
  load: () => Promise<void>;
}) {
  const { view, now, isPhone, token, load } = props;
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
      <Health
        metrics={view.health}
        date={view.date}
        sync={view.healthSync}
        timeZone={view.timeZone}
        isPhone={isPhone}
      />
      {panel}
    </main>
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

/** The home view, refreshed on a timer, when the tab comes back, and when the day changes. */
function useHome(token: Token, onUnauthorized: (setup: boolean) => void) {
  const [view, setView] = useState<HomeView | null>(null);
  const [error, setError] = useState(false);
  // A ref, so a new callback on each render doesn't restart the refresh timer.
  const unauthorized = useRef(onUnauthorized);
  unauthorized.current = onUnauthorized;

  const load = useCallback(async () => {
    try {
      setView(await fetchHome(token));
      setError(false);
    } catch (err) {
      if (err instanceof Unauthorized) {
        unauthorized.current(err.setup);
        return;
      }
      setError(true);
    }
  }, [token]);

  useEffect(() => {
    load();
    const timer = setInterval(load, REFRESH_MS);
    const onVisible = () => document.visibilityState === "visible" && load();
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [load]);

  const today = view ? nowIn(view.timeZone).date : null;
  const viewDate = view?.date;
  useEffect(() => {
    if (today && viewDate && today !== viewDate) {
      load();
    }
  }, [today, viewDate, load]);

  return { view, error, load };
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

/** The live clock in the server's time zone, updated every few seconds. */
function useNow(timeZone: string | undefined): Now | null {
  const [at, setAt] = useState(() => new Date());
  useEffect(() => {
    const timer = setInterval(() => setAt(new Date()), TICK_MS);
    return () => clearInterval(timer);
  }, []);
  return timeZone ? nowIn(timeZone, at) : null;
}

/** The page's #hash, so the Activity page has its own address and the back button works. */
function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash);
  useEffect(() => {
    const onChange = () => {
      setHash(window.location.hash);
      window.scrollTo(0, 0);
    };
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function useMedia(query: string): boolean {
  const [matches, setMatches] = useState(() => window.matchMedia(query).matches);
  useEffect(() => {
    const list = window.matchMedia(query);
    const onChange = () => setMatches(list.matches);
    list.addEventListener("change", onChange);
    return () => list.removeEventListener("change", onChange);
  }, [query]);
  return matches;
}

const root = document.getElementById("app");
if (root) {
  render(<App />, root);
}
