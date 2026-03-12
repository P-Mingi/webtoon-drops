#!/usr/bin/env node
// auto-discover.js — queries AniList for all releasing KR manhwa not yet in the site.
// Paginates all pages, groups by popularity tier. Also scrapes WEBTOON originals.
// Writes DISCOVERY_REPORT.md with pre-filled JSON stubs for human review.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const seriesData = require('../src/data/series-data.json');

const DELAY_MS = 1200; // ~50 req/min — well under AniList 90 req/min limit
const MIN_POPULARITY_STOP = 500; // stop paginating when all entries on a page drop below this

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function slugify(title) {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .replace(/-+/g, '-')
    .replace(/^-|-$/g, '');
}

// ─── AniList discovery ────────────────────────────────────────────────────────

async function fetchAniListPage(page) {
  const query = `
    query ($page: Int) {
      Page(page: $page, perPage: 50) {
        pageInfo { hasNextPage currentPage total }
        media(countryOfOrigin: "KR", type: MANGA, status: RELEASING, sort: POPULARITY_DESC) {
          id
          title { english romaji native }
          coverImage { large }
          popularity
          averageScore
          genres
          siteUrl
          externalLinks { url site }
        }
      }
    }
  `;

  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { page } }),
  });

  if (!res.ok) throw new Error(`AniList HTTP ${res.status} on page ${page}`);
  const { data } = await res.json();
  return data.Page;
}

async function discoverFromAniList(existingIds) {
  console.log('Querying AniList for releasing KR manhwa (all pages)...');

  const allMedia = [];
  let page = 1;
  let hasNextPage = true;

  while (hasNextPage) {
    process.stdout.write(`  Page ${page}...`);
    const pageData = await fetchAniListPage(page);
    allMedia.push(...pageData.media);
    hasNextPage = pageData.pageInfo.hasNextPage;
    const maxPop = Math.max(...pageData.media.map(m => m.popularity ?? 0));
    console.log(` ${pageData.media.length} entries (total: ${allMedia.length}, max pop: ${maxPop.toLocaleString()})`);

    // Stop early: once the most popular entry on this page is very niche, remaining pages
    // will be even more so — not worth traversing thousands of unmaintained series.
    if (maxPop < MIN_POPULARITY_STOP) {
      console.log(`  Max popularity dropped below ${MIN_POPULARITY_STOP}. Stopping early.`);
      hasNextPage = false;
      break;
    }

    if (hasNextPage) {
      await sleep(DELAY_MS);
      page++;
    }
  }

  console.log(`\nFetched ${allMedia.length} total entries across ${page} pages.`);

  const candidates = allMedia
    .filter(m => !existingIds.has(m.id))
    .filter(m => (m.averageScore ?? 0) > 60);

  console.log(`Filtered to ${candidates.length} new candidates (score > 60).\n`);
  return candidates;
}

function buildStub(m) {
  const titleEn = m.title.english ?? m.title.romaji ?? m.title.native ?? 'Unknown';
  const titleNative = m.title.native ?? '';
  return JSON.stringify({
    id: slugify(titleEn),
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
}

function buildAniListSection(candidates) {
  if (candidates.length === 0) {
    return `## AniList — New Candidates\n\nNo new candidates found this week.\n`;
  }

  const tier1 = candidates.filter(m => (m.popularity ?? 0) >= 10000);
  const tier2 = candidates.filter(m => (m.popularity ?? 0) >= 3000 && (m.popularity ?? 0) < 10000);
  const tier3 = candidates.filter(m => (m.popularity ?? 0) < 3000);

  const header = `| Title (EN) | Title (KR) | AniList ID | Popularity | Score | Genres | Link |
|---|---|---|---|---|---|---|`;

  function tableRows(list) {
    return list.map(m => {
      const title = m.title.english ?? m.title.romaji ?? m.title.native ?? 'Unknown';
      const native = m.title.native ?? '';
      return `| ${title} | ${native} | ${m.id} | ${(m.popularity ?? 0).toLocaleString()} | ${m.averageScore ?? 'N/A'} | ${(m.genres ?? []).join(', ')} | [AniList](${m.siteUrl}) |`;
    }).join('\n');
  }

  const allStubs = candidates.map(buildStub).join(',\n\n');

  return `## AniList — New Candidates (${candidates.length} total · score > 60)

### 🔥 Tier 1 — High Popularity (≥ 10,000) · ${tier1.length} series

${tier1.length > 0 ? `${header}\n${tableRows(tier1)}` : '_None_'}

### ⭐ Tier 2 — Mid Popularity (3,000–9,999) · ${tier2.length} series

${tier2.length > 0 ? `${header}\n${tableRows(tier2)}` : '_None_'}

### 📋 Tier 3 — Niche (< 3,000) · ${tier3.length} series

${tier3.length > 0 ? `${header}\n${tableRows(tier3)}` : '_None_'}

---

## Ready-to-paste JSON stubs (AniList)

> **Before adding:** verify \`update_day\`, \`platform\`, and \`read_url\` on the official platform page.
> Replace all \`"NEEDS_MANUAL_VERIFICATION"\` values.

\`\`\`json
[
${allStubs}
]
\`\`\`
`;
}

// ─── WEBTOON originals scraper ────────────────────────────────────────────────

async function discoverFromWebtoon(existingTitleNos) {
  console.log('Scraping WEBTOON originals page...');

  let html;
  try {
    const res = await fetch('https://www.webtoons.com/en/originals/', {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'en-US,en;q=0.9',
      },
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    html = await res.text();
  } catch (err) {
    console.warn(`  Warning: WEBTOON scrape failed (${err.message}). Skipping.`);
    return [];
  }

  // Parse all title_no values from /en/[genre]/[slug]/list?title_no=XXXX URLs
  const titleNoPattern = /\/en\/[^"'\s]+\/list\?title_no=(\d+)/g;
  const genreSlugPattern = /\/en\/([^/]+)\/([^/]+)\/list\?title_no=(\d+)/g;

  const found = new Map(); // title_no → { genre, slug }
  let match;
  while ((match = genreSlugPattern.exec(html)) !== null) {
    const [, genre, slug, titleNo] = match;
    const num = parseInt(titleNo, 10);
    if (!found.has(num)) {
      found.set(num, { genre, slug, titleNo: num });
    }
  }

  // Fallback: just title_no numbers if pattern above missed any
  while ((match = titleNoPattern.exec(html)) !== null) {
    const num = parseInt(match[1], 10);
    if (!found.has(num)) {
      found.set(num, { genre: 'unknown', slug: 'unknown', titleNo: num });
    }
  }

  console.log(`  Found ${found.size} total title_nos on WEBTOON originals page.`);

  const newEntries = [];
  for (const [titleNo, info] of found) {
    if (!existingTitleNos.has(titleNo)) {
      newEntries.push(info);
    }
  }

  console.log(`  ${newEntries.length} not yet in site.\n`);
  return newEntries;
}

function buildWebtoonSection(newEntries) {
  if (newEntries.length === 0) {
    return `## 🆕 New on WEBTOON (not yet in site)\n\nNo new series found.\n`;
  }

  const rows = newEntries.map(({ genre, slug, titleNo }) => {
    const readUrl = `https://www.webtoons.com/en/${genre}/${slug}/list?title_no=${titleNo}`;
    return `| ${titleNo} | ${genre} | ${slug} | [Read](${readUrl}) |`;
  }).join('\n');

  return `## 🆕 New on WEBTOON (not yet in site)

| title_no | Genre | Slug | Read URL |
|---|---|---|---|
${rows}
`;
}

// ─── Main ─────────────────────────────────────────────────────────────────────

async function discover() {
  const existingIds = new Set(seriesData.map(s => s.anilist_id).filter(Boolean));

  // Extract existing WEBTOON title_nos from read_url fields
  const existingTitleNos = new Set();
  for (const s of seriesData) {
    if (s.read_url) {
      const m = s.read_url.match(/title_no=(\d+)/);
      if (m) existingTitleNos.add(parseInt(m[1], 10));
    }
  }

  const [anilistCandidates, webtoonEntries] = await Promise.all([
    discoverFromAniList(existingIds),
    discoverFromWebtoon(existingTitleNos),
  ]);

  const anilistSection = buildAniListSection(anilistCandidates);
  const webtoonSection = buildWebtoonSection(webtoonEntries);

  const report = `# Series Discovery Report

Generated: ${new Date().toISOString()}
Site currently tracks **${seriesData.length}** series.

---

${anilistSection}

---

${webtoonSection}
`;

  const reportPath = path.join(__dirname, '..', 'DISCOVERY_REPORT.md');
  fs.writeFileSync(reportPath, report);

  console.log(`Report written to DISCOVERY_REPORT.md`);
  console.log(`  AniList: ${anilistCandidates.length} new candidates`);
  console.log(`  WEBTOON: ${webtoonEntries.length} new originals`);
}

discover().catch(err => {
  console.error('Discovery failed:', err.message);
  process.exit(1);
});
