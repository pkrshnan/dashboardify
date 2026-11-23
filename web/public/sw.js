// The service worker: shows the reminders the server pushes and opens the app where a tap points.
// Plain JavaScript served at /sw.js, so its scope is the whole app; it caches nothing. The
// message fields are PushMessage in src/notifications/notifier.ts.

const FALLBACK = { title: "Command center", body: "", tag: "", url: "/#/" };

self.addEventListener("install", () => self.skipWaiting());

self.addEventListener("activate", (event) => event.waitUntil(self.clients.claim()));

// Every push must show something: Safari stops delivering to a worker that stays silent.
self.addEventListener("push", (event) => {
  const message = readMessage(event.data);
  event.waitUntil(
    self.registration.showNotification(message.title, {
      body: message.body,
      tag: message.tag || undefined,
      icon: "/icon-512.png",
      badge: "/icon-512.png",
      data: { url: message.url },
    }),
  );
});

self.addEventListener("notificationclick", (event) => {
  event.notification.close();
  event.waitUntil(openApp(event.notification.data?.url ?? FALLBACK.url));
});

function readMessage(data) {
  try {
    return { ...FALLBACK, ...data?.json() };
  } catch {
    return FALLBACK;
  }
}

/** Focuses the open app and tells it where to go (web/app.tsx), or opens a new one there. */
async function openApp(url) {
  const target = new URL(url, self.location.origin);
  if (target.origin !== self.location.origin) {
    return;
  }
  const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
  const open = windows[0];
  if (!open) {
    await self.clients.openWindow(target.href);
    return;
  }
  open.postMessage({ type: "open", hash: target.hash });
  await open.focus();
}
