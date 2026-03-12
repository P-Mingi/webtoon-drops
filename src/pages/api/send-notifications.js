// send-notifications.js — GET endpoint called by hourly Vercel cron.
// Finds series dropping in the next 60 minutes and sends push notifications.
//
// VAPID env vars required:
//   VAPID_SUBJECT   e.g. mailto:hello@webtoondrops.com
//   VAPID_PUBLIC_KEY
//   VAPID_PRIVATE_KEY
//   (Run `npx web-push generate-vapid-keys` to generate the key pair)

export const prerender = false;

import seriesData from '../../data/series-data.json';

let kv;
let webpush;
try {
  ([{ kv }, webpush] = await Promise.all([
    import('@vercel/kv'),
    import('web-push'),
  ]));
} catch {
  kv = null;
  webpush = null;
}

// ─── KST drop-time math ───────────────────────────────────────────────────────
// Copied from src/scripts/countdown.js (no import — avoid client-bundle issues)
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

function getNextDropUTC(dayOfWeek) {
  const now = new Date();
  const nowKST = new Date(now.getTime() + KST_OFFSET_MS);
  const currentDayKST = nowKST.getUTCDay();
  let daysAhead = (dayOfWeek - currentDayKST + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  const nextMidnightKST = new Date(nowKST);
  nextMidnightKST.setUTCDate(nextMidnightKST.getUTCDate() + daysAhead);
  nextMidnightKST.setUTCHours(0, 0, 0, 0);
  return new Date(nextMidnightKST.getTime() - KST_OFFSET_MS);
}

// Returns the actual UTC drop datetime for a series, accounting for release_hour_kst.
// Unlike getNextDropUTC, this handles "later today" correctly.
function getDropTimeUTC(dayOfWeek, releaseHourKST = 0) {
  const now = new Date();
  const nowKST = new Date(now.getTime() + KST_OFFSET_MS);
  const currentDayKST = nowKST.getUTCDay();
  let daysAhead = (dayOfWeek - currentDayKST + 7) % 7;

  // Build candidate: this week at releaseHourKST
  const candidateKST = new Date(nowKST);
  candidateKST.setUTCDate(candidateKST.getUTCDate() + daysAhead);
  candidateKST.setUTCHours(releaseHourKST, 0, 0, 0);
  const candidateUTC = new Date(candidateKST.getTime() - KST_OFFSET_MS);

  if (candidateUTC > now) return candidateUTC;

  // Already dropped → return next week
  candidateKST.setUTCDate(candidateKST.getUTCDate() + 7);
  return new Date(candidateKST.getTime() - KST_OFFSET_MS);
}

// ─── Main handler ─────────────────────────────────────────────────────────────

export async function GET() {
  if (!kv || !webpush) {
    // Stub: dependencies not available locally.
    // TODO: configure VAPID keys + KV before deploying.
    console.warn('[send-notifications] Dependencies not available — skipping.');
    return new Response(JSON.stringify({ ok: true, sent: 0, stubbed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const vapidSubject = process.env.VAPID_SUBJECT;
  const vapidPublicKey = process.env.VAPID_PUBLIC_KEY;
  const vapidPrivateKey = process.env.VAPID_PRIVATE_KEY;

  if (!vapidSubject || !vapidPublicKey || !vapidPrivateKey) {
    console.error('[send-notifications] Missing VAPID env vars.');
    return new Response('Missing VAPID configuration', { status: 500 });
  }

  webpush.setVapidDetails(vapidSubject, vapidPublicKey, vapidPrivateKey);

  const now = new Date();
  const windowEnd = new Date(now.getTime() + 60 * 60 * 1000); // +60 min

  const droppingNow = seriesData.filter(s => {
    if (s.on_hiatus) return false;
    const dropTime = getDropTimeUTC(s.update_day, s.release_hour_kst ?? 0);
    return dropTime > now && dropTime <= windowEnd;
  });

  let sent = 0;
  let removed = 0;

  for (const series of droppingNow) {
    const key = `subs:${series.id}`;
    const subscriptions = (await kv.get(key)) ?? [];
    if (subscriptions.length === 0) continue;

    const payload = JSON.stringify({
      title: series.title,
      body: `New episode dropping in less than an hour!`,
      icon: '/icon-192.png',
      badge: '/icon-96.png',
      url: `/${series.id}`,
    });

    const active = [];
    for (const sub of subscriptions) {
      try {
        await webpush.sendNotification(sub, payload);
        active.push(sub);
        sent++;
      } catch (err) {
        if (err.statusCode === 410) {
          // Subscription expired — drop it
          removed++;
        } else {
          console.error(`[send-notifications] Push failed for ${series.id}:`, err.message);
          active.push(sub); // keep on transient errors
        }
      }
    }

    // Update KV with stale subscriptions removed
    if (active.length !== subscriptions.length) {
      await kv.set(key, active);
    }
  }

  console.log(`[send-notifications] Sent ${sent} pushes, removed ${removed} stale subs. Series dropping: ${droppingNow.map(s => s.id).join(', ') || 'none'}`);

  return new Response(JSON.stringify({ ok: true, sent, removed, series: droppingNow.map(s => s.id) }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
