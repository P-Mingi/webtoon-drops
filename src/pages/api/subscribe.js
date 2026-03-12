// subscribe.js — POST endpoint to store a push subscription for a series.
// Body: { subscription: PushSubscription, seriesId: string }
//
// Storage: Vercel KV key `subs:${seriesId}` → array of PushSubscription objects.
// De-duped by endpoint URL so the same browser/device is never stored twice.

export const prerender = false;

let kv;
try {
  ({ kv } = await import('@vercel/kv'));
} catch {
  kv = null; // @vercel/kv not available (local dev without KV binding)
}

export async function POST({ request }) {
  if (!kv) {
    // Stub: KV not configured. Respond 200 so the client shows success locally.
    // TODO: configure Vercel KV (or Upstash Redis) in Vercel dashboard before deploying.
    console.warn('[subscribe] @vercel/kv not available — subscription not persisted.');
    return new Response(JSON.stringify({ ok: true, stubbed: true }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return new Response('Invalid JSON', { status: 400 });
  }

  const { subscription, seriesId } = body;
  if (!subscription?.endpoint || !seriesId) {
    return new Response('Missing subscription or seriesId', { status: 400 });
  }

  const key = `subs:${seriesId}`;
  const existing = (await kv.get(key)) ?? [];
  const deduped = existing.filter(s => s.endpoint !== subscription.endpoint);
  deduped.push(subscription);
  await kv.set(key, deduped);

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}
