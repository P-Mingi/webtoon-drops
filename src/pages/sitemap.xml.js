import seriesData from '../data/series-data.json';
import comparePairs from '../data/compare-pairs.json';

export async function GET() {
  const homepage = `  <url>
    <loc>https://webtoondrops.com</loc>
    <changefreq>daily</changefreq>
    <priority>1.0</priority>
  </url>`;

  const justDropped = `  <url>
    <loc>https://webtoondrops.com/just-dropped</loc>
    <changefreq>daily</changefreq>
    <priority>0.9</priority>
  </url>`;

  const thisWeek = `  <url>
    <loc>https://webtoondrops.com/this-week</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`;

  const genreIndex = `  <url>
    <loc>https://webtoondrops.com/genre</loc>
    <changefreq>weekly</changefreq>
    <priority>0.7</priority>
  </url>`;

  const genres = [...new Set(seriesData.map(s => s.genre).filter(Boolean))];
  const genreUrls = genres.map(g => `  <url>
    <loc>https://webtoondrops.com/genre/${g.toLowerCase().replace(/\s+/g, '-')}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.8</priority>
  </url>`);

  const compareUrls = comparePairs.map(([a, b]) => `  <url>
    <loc>https://webtoondrops.com/compare/${a}-vs-${b}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.6</priority>
  </url>`);

  const seriesUrls = seriesData.map(s => `  <url>
    <loc>https://webtoondrops.com/${s.id}</loc>
    <changefreq>weekly</changefreq>
    <priority>0.9</priority>
  </url>`);

  const body = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${homepage}
${justDropped}
${thisWeek}
${genreIndex}
${genreUrls.join('\n')}
${compareUrls.join('\n')}
${seriesUrls.join('\n')}
</urlset>`;

  return new Response(body, { headers: { 'Content-Type': 'application/xml' } });
}
