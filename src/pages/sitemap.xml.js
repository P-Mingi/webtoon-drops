import seriesData from '../data/series-data.json';

export async function GET() {
  const urls = [
    'https://webtoondrops.com',
    ...seriesData.map(s => `https://webtoondrops.com/${s.id}`)
  ];
  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  ${urls.map(url => `<url><loc>${url}</loc><changefreq>daily</changefreq></url>`).join('\n  ')}
</urlset>`;
  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
