// sw.js — WebtoonDrops service worker
// Receives push notifications and handles click actions.

self.addEventListener('push', event => {
  if (!event.data) return;

  let payload;
  try {
    payload = event.data.json();
  } catch {
    payload = { title: 'WebtoonDrops', body: event.data.text() };
  }

  const { title, body, icon, badge, url } = payload;

  event.waitUntil(
    self.registration.showNotification(title ?? 'WebtoonDrops', {
      body: body ?? 'A new episode is dropping soon!',
      icon: icon ?? '/icon-192.png',
      badge: badge ?? '/icon-96.png',
      data: { url: url ?? '/' },
      actions: [
        { action: 'read', title: 'Read now' },
        { action: 'dismiss', title: 'Dismiss' },
      ],
    })
  );
});

self.addEventListener('notificationclick', event => {
  event.notification.close();

  if (event.action === 'dismiss') return;

  const targetUrl = event.notification.data?.url ?? '/';

  event.waitUntil(
    clients.matchAll({ type: 'window', includeUncontrolled: true }).then(windowClients => {
      for (const client of windowClients) {
        if (client.url === targetUrl && 'focus' in client) {
          return client.focus();
        }
      }
      if (clients.openWindow) {
        return clients.openWindow(targetUrl);
      }
    })
  );
});
