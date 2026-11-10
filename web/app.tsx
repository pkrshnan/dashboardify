// The web app's shell: sign-in, then the page the address names (web/modules/). The home view
// (GET /v1/home) is loaded here, once, for every page that needs it, and refreshed every few
// minutes, when the tab comes back, and at midnight.

import { render } from "preact";
import { useCallback, useEffect, useRef, useState } from "preact/hooks";
import type { HomeView } from "../src/home/types";
import { fetchHome, savedToken, saveToken, type Token, Unauthorized } from "./api";
import { Sidebar, TabBar } from "./components/nav";
import { SignIn } from "./components/sign-in";
import { type Now, nowIn } from "./lib/clock";
import { useRoute } from "./lib/use-route";
import { AppContext } from "./modules/context";
import { MODULES, MORE, pageFor } from "./modules/index";
import type { LoadedHome } from "./modules/types";
import { tokenFromHash } from "./settings/sign-in-link";

const REFRESH_MS = 5 * 60_000;
const TICK_MS = 15_000;
const PHONE_QUERY = "(max-width: 899px)";

/** Straight to the page; the sign-in screen only when the server wants a token. */
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
  return <Shell token={token} onUnauthorized={unauthorized} />;
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

/**
 * The page for the address, beside the sidebar on desktop and above the tab bar on the phone.
 * A page that needs the home view waits for it; the nav shows at once.
 */
function Shell(props: { token: Token; onUnauthorized: (setup: boolean) => void }) {
  const { token, onUnauthorized } = props;
  const route = useRoute();
  const isPhone = useMedia(PHONE_QUERY);
  const { view, error, load } = useHome(token, onUnauthorized);
  const now = useNow(view?.timeZone);
  const home: LoadedHome | null = view && now ? { view, now, load } : null;
  const { module, params } = pageFor(route.path);
  const View = module.view;

  return (
    <AppContext.Provider value={{ token, onUnauthorized, isPhone }}>
      <div class="frame">
        {!isPhone && <Sidebar modules={MODULES} current={module.id} />}
        <div class="frame-page">
          {module.needsHome && !home ? (
            <p class="sign-in muted">{error ? "Can't reach the server." : ""}</p>
          ) : (
            <View route={route} params={params} home={home} />
          )}
        </div>
        {isPhone && <TabBar modules={MODULES} current={module.id} more={MORE} />}
      </div>
    </AppContext.Provider>
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
