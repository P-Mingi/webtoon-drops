// notifications.js — client-side push subscription manager.
//
// VAPID setup (one-time):
//   npx web-push generate-vapid-keys
//   Add PUBLIC_VAPID_KEY to .env (also exposed as VITE_ for client access).
//   Add VAPID_PRIVATE_KEY + VAPID_SUBJECT to Vercel env vars (server-only).

const STORAGE_KEY = 'wt_subs';

// VAPID public key is injected at build time via Astro/Vite.
// In .env: PUBLIC_VAPID_KEY=BExamplePublicKeyHere...
function getVapidPublicKey() {
  return import.meta.env.PUBLIC_VAPID_KEY ?? '';
}

// Convert VAPID base64url public key to Uint8Array (required by PushManager)
function urlBase64ToUint8Array(base64String) {
  const padding = '='.repeat((4 - (base64String.length % 4)) % 4);
  const base64 = (base64String + padding).replace(/-/g, '+').replace(/_/g, '/');
  const rawData = atob(base64);
  return Uint8Array.from([...rawData].map(c => c.charCodeAt(0)));
}

// Returns the Set of subscribed series IDs from localStorage.
function getSubscribedSet() {
  try {
    return new Set(JSON.parse(localStorage.getItem(STORAGE_KEY) ?? '[]'));
  } catch {
    return new Set();
  }
}

// Returns true if the user has subscribed to push for this series.
export function isSubscribed(seriesId) {
  return getSubscribedSet().has(seriesId);
}

// Request permission, subscribe via PushManager, POST to /api/subscribe.
// Returns true on success, false if permission denied or subscription failed.
export async function subscribeToSeries(seriesId) {
  if (!('Notification' in window) || !('serviceWorker' in navigator)) {
    alert('Push notifications are not supported in this browser.');
    return false;
  }

  const permission = await Notification.requestPermission();
  if (permission !== 'granted') return false;

  const vapidKey = getVapidPublicKey();
  if (!vapidKey) {
    console.warn('PUBLIC_VAPID_KEY not set — notifications disabled.');
    return false;
  }

  try {
    const reg = await navigator.serviceWorker.ready;
    const subscription = await reg.pushManager.subscribe({
      userVisibleOnly: true,
      applicationServerKey: urlBase64ToUint8Array(vapidKey),
    });

    const res = await fetch('/api/subscribe', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ subscription, seriesId }),
    });

    if (!res.ok) {
      console.error('Subscribe API error:', res.status);
      return false;
    }

    // Persist to localStorage so we can show the subscribed state on reload
    const subs = getSubscribedSet();
    subs.add(seriesId);
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...subs]));
    return true;
  } catch (err) {
    console.error('Subscription failed:', err);
    return false;
  }
}
