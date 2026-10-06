let registration: Promise<ServiceWorkerRegistration | null> | null = null;

export function registerDashboardServiceWorker(): Promise<ServiceWorkerRegistration | null> {
  if (!('serviceWorker' in navigator)) return Promise.resolve(null);
  registration ??= navigator.serviceWorker.register('/service-worker.js', { scope: '/' })
    .then(() => navigator.serviceWorker.ready)
    .catch(() => null);
  return registration;
}

export function applicationServerKey(value: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - value.length % 4) % 4);
  const base64 = (value + padding).replace(/-/g, '+').replace(/_/g, '/');
  const decoded = window.atob(base64);
  const key = new Uint8Array(new ArrayBuffer(decoded.length));
  for (let index = 0; index < decoded.length; index += 1) key[index] = decoded.charCodeAt(index);
  return key;
}
