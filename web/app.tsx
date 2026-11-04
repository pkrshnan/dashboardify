// The home screen: focus, then calendar and tasks, then health trends. It loads everything from
// GET /api/home and refreshes every few minutes, when the tab comes back, and at midnight.

import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { HomeView } from "../src/home/types";
import { addTask, completeTask, fetchHome, savedToken, saveToken, Unauthorized } from "./api";
import { Calendar } from "./components/calendar";
import { Focus } from "./components/focus";
import { Health } from "./components/health";
import { SignIn } from "./components/sign-in";
import { TaskList } from "./components/task-list";
import { type Now, nowIn } from "./lib/clock";

const REFRESH_MS = 5 * 60_000;
const TICK_MS = 15_000;
const PHONE_QUERY = "(max-width: 899px)";

function App() {
  const [token, setToken] = useState(savedToken);
  const [failed, setFailed] = useState(false);
  if (!token) {
    return (
      <SignIn
        failed={failed}
        onToken={(t) => {
          saveToken(t);
          setFailed(false);
          setToken(t);
        }}
      />
    );
  }
  const signOut = () => {
    saveToken(null);
    setFailed(true);
    setToken(null);
  };
  return <Home token={token} onUnauthorized={signOut} />;
}

function Home({ token, onUnauthorized }: { token: string; onUnauthorized: () => void }) {
  const { view, error, load } = useHome(token, onUnauthorized);
  const [done, setDone] = useState(new Set<string>());
  const now = useNow(view?.timeZone);
  const isPhone = useMedia(PHONE_QUERY);

  if (!(view && now)) {
    return <p class="sign-in muted">{error ? "Can't reach the server." : ""}</p>;
  }
  const complete = (id: string) => {
    setDone((d) => new Set(d).add(id));
    completeTask(token, id).then(load, load);
  };
  const add = async (text: string) => {
    const result = await addTask(token, text);
    await load();
    return result.message;
  };
  const tasks = <TaskList groups={view.tasks} done={done} onComplete={complete} onAdd={add} />;
  return (
    <main class="home">
      <Focus view={view} now={now} />
      <Calendar
        view={withTicked(view, done)}
        nowMin={now.minutes}
        isPhone={isPhone}
        onComplete={complete}
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
      <Health metrics={view.health} date={view.date} isPhone={isPhone} />
    </main>
  );
}

/** The home view, refreshed on a timer, when the tab comes back, and when the day changes. */
function useHome(token: string, onUnauthorized: () => void) {
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
        unauthorized.current();
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

/** Reminders ticked in this session show as done before the refresh confirms it. */
function withTicked(view: HomeView, done: Set<string>): HomeView {
  const days = view.days.map((d) => ({
    ...d,
    reminders: d.reminders.map((r) => ({ ...r, done: r.done || done.has(r.id) })),
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
