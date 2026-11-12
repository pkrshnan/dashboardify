// What every page needs from the shell, so it isn't passed down through each component: the
// device token, what to do when the server refuses it, and whether this is the phone layout.

import { createContext } from "preact";
import { useContext } from "preact/hooks";
import type { Token } from "../api";

export interface App {
  token: Token;
  /** The server refused the token; `setup` when it is waiting for a setup code. */
  onUnauthorized: (setup: boolean) => void;
  isPhone: boolean;
}

export const AppContext = createContext<App | null>(null);

export function useApp(): App {
  const app = useContext(AppContext);
  if (!app) {
    throw new Error("useApp outside AppContext");
  }
  return app;
}
