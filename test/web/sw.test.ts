import { describe, expect, test } from "bun:test";
import { join } from "node:path";
import { openHash } from "../../web/lib/service-worker";

const SOURCE = await Bun.file(join(import.meta.dir, "../../web/public/sw.js")).text();
const ORIGIN = "https://dash.example.ts.net";

type Handler = (event: Record<string, unknown>) => void;

/** Runs sw.js against a fake worker scope and records what it does. */
function worker(windows: { postMessage: (m: unknown) => void; focus: () => Promise<void> }[] = []) {
  const handlers = new Map<string, Handler>();
  const shown: { title: string; options: Record<string, unknown> }[] = [];
  const opened: string[] = [];
  const scope = {
    location: { origin: ORIGIN },
    addEventListener: (type: string, handler: Handler) => handlers.set(type, handler),
    skipWaiting: () => Promise.resolve(),
    registration: {
      showNotification: (title: string, options: Record<string, unknown>) => {
        shown.push({ title, options });
        return Promise.resolve();
      },
    },
    clients: {
      claim: () => Promise.resolve(),
      matchAll: () => Promise.resolve(windows),
      openWindow: (url: string) => {
        opened.push(url);
        return Promise.resolve();
      },
    },
  };
  new Function("self", SOURCE)(scope);

  /** Fires an event and waits for what it handed to waitUntil. */
  async function fire(type: string, event: Record<string, unknown>) {
    let pending: Promise<unknown> = Promise.resolve();
    handlers.get(type)?.({ ...event, waitUntil: (p: Promise<unknown>) => (pending = p) });
    await pending;
  }
  return { fire, shown, opened };
}

function pushEvent(payload: unknown) {
  return { data: { json: () => (typeof payload === "string" ? JSON.parse(payload) : payload) } };
}

function click(url: string | undefined) {
  let closed = false;
  return {
    event: {
      notification: { data: url === undefined ? undefined : { url }, close: () => (closed = true) },
    },
    closed: () => closed,
  };
}

describe("service worker", () => {
  test("shows a push with its title, body and tag", async () => {
    const sw = worker();

    await sw.fire(
      "push",
      pushEvent({
        title: "Standup",
        body: "In 10 min · 10:00–10:30",
        tag: "event:a:1",
        url: "/#/",
      }),
    );

    expect(sw.shown).toEqual([
      {
        title: "Standup",
        options: {
          body: "In 10 min · 10:00–10:30",
          tag: "event:a:1",
          icon: "/icon-512.png",
          badge: "/icon-512.png",
          data: { url: "/#/" },
        },
      },
    ]);
  });

  test("a push it can't read still shows something", async () => {
    const sw = worker();

    await sw.fire("push", pushEvent("not json"));
    await sw.fire("push", { data: null });

    expect(sw.shown.map((n) => n.title)).toEqual(["Command center", "Command center"]);
  });

  test("a tap with the app closed opens it at the address", async () => {
    const sw = worker();
    const tap = click("/#/?event=events%2Fabc");

    await sw.fire("notificationclick", tap.event);

    expect(tap.closed()).toBe(true);
    expect(sw.opened).toEqual([`${ORIGIN}/#/?event=events%2Fabc`]);
  });

  test("a tap with the app open focuses it and sends it the address", async () => {
    const messages: unknown[] = [];
    let focused = false;
    const sw = worker([
      {
        postMessage: (m) => messages.push(m),
        focus: () => {
          focused = true;
          return Promise.resolve();
        },
      },
    ]);

    await sw.fire("notificationclick", click("/#/lists/tasks").event);

    expect(messages).toEqual([{ type: "open", hash: "#/lists/tasks" }]);
    expect(focused).toBe(true);
    expect(sw.opened).toEqual([]);
  });

  test("never opens another site", async () => {
    const sw = worker();

    await sw.fire("notificationclick", click("https://evil.example/#/").event);

    expect(sw.opened).toEqual([]);
  });
});

describe("openHash", () => {
  test("takes only open messages with one of our addresses", () => {
    expect(openHash({ type: "open", hash: "#/lists/tasks" })).toBe("#/lists/tasks");
    expect(openHash({ type: "open", hash: "javascript:alert(1)" })).toBeUndefined();
    expect(openHash({ type: "other", hash: "#/" })).toBeUndefined();
    expect(openHash("#/")).toBeUndefined();
    expect(openHash(null)).toBeUndefined();
  });
});
