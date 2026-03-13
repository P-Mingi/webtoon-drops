import seriesData from '../data/series-data.json';

export async function GET() {
  const homepage = `  <url>
    <loc>https://webtoondrops.com</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

  const thisWeek = `  <url>
    <loc>https://webtoondrops.com/this-week</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`;

  const seriesUrls = seriesData.map(s => `  <url>
    <loc>https://webtoondrops.com/${s.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${homepage}
${thisWeek}
${seriesUrls.join('\n')}
</urlset>`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
