// Minimal service worker for Esprey Tasks. It does NOT cache anything (no fetch
// handler) — it exists so we can show OS notifications cross-platform (Android
// requires showNotification via a service worker) and handle clicks on them.

self.addEventListener('install', () => self.skipWaiting());
self.addEventListener('activate', (event) => event.waitUntil(self.clients.claim()));

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = (event.notification.data && event.notification.data.url) || '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const client of list) {
        if ('focus' in client) {
          client.focus();
          if ('navigate' in client && url) { try { client.navigate(url); } catch (e) { /* noop */ } }
          return undefined;
        }
      }
      if (self.clients.openWindow) return self.clients.openWindow(url);
      return undefined;
    }),
  );
});
