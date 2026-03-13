// Called every Monday midnight UTC by Vercel cron — triggers a redeploy
// so the static /this-week page regenerates with the new week's dates.
export async function GET() {
  const deployHookUrl = import.meta.env.VERCEL_DEPLOY_HOOK;

  if (!deployHookUrl) {
    return new Response(JSON.stringify({ ok: false, reason: 'no hook configured' }), { status: 200 });
  }

  await fetch(deployHookUrl, { method: 'POST' });
  return new Response(JSON.stringify({ ok: true, triggered: new Date().toISOString() }), { status: 200 });
}
