// Talks to the server's /api. Opened through Tailscale, the server knows who you are and no
// token is needed. Anywhere else (local development, the demo) the server answers 401, and the
// sign-in screen asks for a device token, which is kept in localStorage.

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

export type Token = string | null;

async function call<T>(token: Token, path: string, init: RequestInit = {}): Promise<T> {
  const headers: Record<string, string> = { "content-type": "application/json" };
  if (token) {
    headers.authorization = `Bearer ${token}`;
  }
  const response = await fetch(`/api${path}`, { ...init, headers });
  if (response.status === 401) {
    throw new Unauthorized("unauthorized");
  }
  if (!response.ok) {
    throw new Error(`${path}: ${response.status}`);
  }
  return (await response.json()) as T;
}

export function fetchHome(token: Token): Promise<HomeView> {
  return call<HomeView>(token, "/home");
}

export function completeTask(token: Token, id: string): Promise<unknown> {
  return call(token, `/tasks/${encodeURIComponent(id)}/complete`, { method: "POST" });
}

/** Add a task from typed text; the server reads dates and times out of it ("Fri 10:00"). */
export function addTask(token: Token, text: string): Promise<{ message: string }> {
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
