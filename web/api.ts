// Talks to the server's /api. Every call needs a device token (see docs/api.md); the browser
// keeps its token in localStorage, set once on the sign-in screen.

import type { HomeView } from "../src/home/types";

const TOKEN_KEY = "dashboardify.token";

export class Unauthorized extends Error {}

export function savedToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function saveToken(token: string | null): void {
  try {
    if (token) {
      localStorage.setItem(TOKEN_KEY, token);
    } else {
      localStorage.removeItem(TOKEN_KEY);
    }
  } catch {
    // Private mode: the token lasts until the page closes.
  }
}

async function call<T>(token: string, path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api${path}`, {
    ...init,
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json",
      ...init.headers,
    },
  });
  if (response.status === 401) {
    throw new Unauthorized("unauthorized");
  }
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchHome(token: string): Promise<HomeView> {
  return call<HomeView>(token, "/home");
}

export function completeTask(token: string, id: string): Promise<unknown> {
  return call(token, `/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" });
}

/** Add a task from typed text; the server reads dates and times out of it ("Fri 10:00"). */
export function addTask(token: string, text: string): Promise<{ message: string }> {
  return call(token, "/tasks", {
    method: "POST",
    body: JSON.stringify({ key: randomKey(), text }),
  });
}

/** randomUUID needs HTTPS; over plain HTTP on the tailnet fall back to random bytes. */
function randomKey(): string {
  if (typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  const bytes = crypto.getRandomValues(new Uint8Array(16));
  return Array.from(bytes, (b) => b.toString(16).padStart(2, "0")).join("");
}
