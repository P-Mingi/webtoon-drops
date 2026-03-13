export async function GET({ site }) {
  const base = site?.toString().replace(/\/$/, '') ?? 'https://webtoondrops.com';
  return new Response(
    `User-agent: *\nAllow: /\n\nSitemap: ${base}/sitemap.xml\n`,
    { headers: { 'Content-Type': 'text/plain' } }
  );
}
