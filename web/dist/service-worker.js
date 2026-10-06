const fallbackNotification = {
  title: 'Dashboardify reminder',
  body: 'A reminder is due. Open Dashboardify for details.',
  tag: 'dashboardify-reminder',
  url: '/',
};

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('push', (event) => {
  let notification = fallbackNotification;
  if (event.data) {
    try {
      notification = { ...fallbackNotification, ...event.data.json() };
    } catch {
      notification = fallbackNotification;
    }
  }
  event.waitUntil(self.registration.showNotification(notification.title, {
    body: notification.body,
    tag: notification.tag,
    icon: '/icons/icon-192.png',
    badge: '/icons/badge-96.png',
    data: { url: notification.url },
  }));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || '/', self.location.origin).href;
  event.waitUntil(self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then(async (windows) => {
    for (const windowClient of windows) {
      if (new URL(windowClient.url).origin !== self.location.origin) continue;
      if ('navigate' in windowClient) await windowClient.navigate(target);
      return windowClient.focus();
    }
    return self.clients.openWindow(target);
  }));
});
