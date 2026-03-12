#!/usr/bin/env node
// auto-discover.js — queries AniList weekly for new popular KR manhwa not yet in the site.
// Writes DISCOVERY_REPORT.md with pre-filled JSON stubs for human review.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const seriesData = require('../src/data/series-data.json');

const ANILIST_QUERY = `
  query {
    Page(page: 1, perPage: 50) {
      media(countryOfOrigin: "KR", type: MANGA, status: RELEASING, sort: POPULARITY_DESC) {
        id
        title { english romaji native }
        coverImage { large }
        popularity
        averageScore
        genres
        siteUrl
      }
    }
  }
`;

async function discover() {
  console.log('Querying AniList for popular releasing KR manhwa...\n');

  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query: ANILIST_QUERY }),
  });

  if (!res.ok) {
    console.error(`AniList request failed: ${res.status}`);
    process.exit(1);
  }

  const { data } = await res.json();
  const existingIds = new Set(seriesData.map(s => s.anilist_id).filter(Boolean));
  const existingTitles = new Set(seriesData.map(s => s.title.toLowerCase()));

  const candidates = data.Page.media
    .filter(m => !existingIds.has(m.id))
    .filter(m => (m.popularity ?? 0) > 5000)
    .filter(m => (m.averageScore ?? 0) > 70);

  if (candidates.length === 0) {
    console.log('No new candidates found matching criteria (popularity > 5000, score > 70).');
    fs.writeFileSync(
      path.join(__dirname, '..', 'DISCOVERY_REPORT.md'),
      `# Series Discovery Report\n\nGenerated: ${new Date().toISOString()}\n\nNo new candidates found this week.\n`
    );
    process.exit(0);
  }

  const tableRows = candidates.map(m => {
    const title = m.title.english ?? m.title.romaji ?? m.title.native ?? 'Unknown';
    const native = m.title.native ?? '';
    return `| ${title} | ${native} | ${m.id} | ${(m.popularity ?? 0).toLocaleString()} | ${m.averageScore ?? 'N/A'} | ${(m.genres ?? []).join(', ')} | [AniList](${m.siteUrl}) |`;
  }).join('\n');

  const stubs = candidates.map(m => {
    const titleEn = m.title.english ?? m.title.romaji ?? m.title.native ?? 'Unknown';
    const titleNative = m.title.native ?? '';
    const slug = titleEn
      .toLowerCase()
      .replace(/[^a-z0-9\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');

    return JSON.stringify({
      id: slug,
      title: titleEn,
      title_kr: titleNative,
      anilist_id: m.id,
      platform: 'NEEDS_MANUAL_VERIFICATION',
      platform_label: 'NEEDS_MANUAL_VERIFICATION',
      read_url: 'NEEDS_MANUAL_VERIFICATION',
      update_day: 'NEEDS_MANUAL_VERIFICATION',
      update_day_name: 'NEEDS_MANUAL_VERIFICATION',
      release_hour_kst: 0,
      on_hiatus: false,
      genre: (m.genres ?? [])[0] ?? 'Action',
      tags: (m.genres ?? []).map(g => g.toLowerCase()),
      amazon_vol1: null,
      seo_description: `${titleEn} countdown and next episode release date. Live timer on WebtoonDrops.`,
    }, null, 2);
  }).join(',\n\n');

  const report = `# Series Discovery Report

Generated: ${new Date().toISOString()}
Found **${candidates.length}** new candidates (popularity > 5,000 · score > 70).

---

## Candidates

| Title (EN) | Title (KR) | AniList ID | Popularity | Score | Genres | Link |
|---|---|---|---|---|---|---|
${tableRows}

---

## Ready-to-paste JSON stubs

> **Before adding:** verify \`update_day\`, \`platform\`, and \`read_url\` on the official platform page.
> Replace all \`"NEEDS_MANUAL_VERIFICATION"\` values.

\`\`\`json
[
${stubs}
]
\`\`\`
`;

  const reportPath = path.join(__dirname, '..', 'DISCOVERY_REPORT.md');
  fs.writeFileSync(reportPath, report);
  console.log(`Found ${candidates.length} new candidates. See DISCOVERY_REPORT.md`);
}

discover().catch(err => {
  console.error('Discovery failed:', err.message);
  process.exit(1);
});
