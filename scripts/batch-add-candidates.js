#!/usr/bin/env node
// batch-add-candidates.js — reads Tier 1 candidates from DISCOVERY_REPORT.md,
// re-fetches AniList externalLinks, fetches WEBTOON RSS for update_day,
// merges auto-detectable entries into series-data.json.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));

const DATA_PATH    = path.join(__dirname, '..', 'src', 'data', 'series-data.json');
const REPORT_PATH  = path.join(__dirname, '..', 'DISCOVERY_REPORT.md');
const OUTPUT_PATH  = path.join(__dirname, 'batch-add-output.json');
const MANUAL_PATH  = path.join(__dirname, 'batch-add-manual.md');

const seriesData = require(DATA_PATH);

const DELAY_MS = 1200;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function slugify(t) {
  return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

function chunk(arr, size) {
  const out = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ─── Genre mapping ─────────────────────────────────────────────────────────

const GENRE_PRIORITY = [
  ['Sports',       ['Sports']],
  ['Martial Arts', ['Martial Arts']],
  ['Romance',      ['Romance']],
  ['Comedy',       ['Comedy']],
  ['Thriller',     ['Mystery', 'Thriller', 'Psychological']],
  ['Supernatural', ['Supernatural', 'Horror']],
  ['Drama',        ['Drama', 'Slice of Life']],
  ['Fantasy',      ['Fantasy']],
  ['Action',       ['Action', 'Adventure', 'Sci-Fi']],
];

function mapGenre(genres) {
  for (const [label, matches] of GENRE_PRIORITY) {
    if (genres.some(g => matches.includes(g))) return label;
  }
  return 'Action';
}

// ─── Parse DISCOVERY_REPORT.md ─────────────────────────────────────────────

function parseTier1(reportPath) {
  const content = fs.readFileSync(reportPath, 'utf8');
  const tier1Match = content.match(/### 🔥 Tier 1[\s\S]*?(?=### ⭐|### 📋|^---)/m);
  if (!tier1Match) throw new Error('Tier 1 section not found in DISCOVERY_REPORT.md');

  const candidates = [];
  // Row: | Title | KR Title | AniList ID | Popularity | Score | Genres | Link |
  const rowRe = /^\|\s*([^|]+?)\s*\|\s*([^|]*?)\s*\|\s*(\d+)\s*\|\s*[\d,]+\s*\|\s*[\w./]+\s*\|\s*([^|]+?)\s*\|\s*[^|]+\s*\|/gm;
  let m;
  while ((m = rowRe.exec(tier1Match[0])) !== null) {
    const [, title, titleKr, id, genres] = m;
    if (title.trim() === 'Title (EN)') continue;
    candidates.push({
      title: title.trim(),
      title_kr: titleKr.trim() || null,
      anilist_id: parseInt(id),
      genres: genres.split(',').map(g => g.trim()).filter(Boolean),
    });
  }
  return candidates;
}

// ─── AniList: fetch externalLinks + status ─────────────────────────────────

async function fetchAniListDetails(ids) {
  const query = `
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: MANGA) {
          id
          status
          title { english romaji }
          externalLinks { url site }
        }
      }
    }
  `;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { ids } }),
  });
  if (!res.ok) throw new Error(`AniList HTTP ${res.status}`);
  const { data } = await res.json();
  return data.Page.media;
}

// ─── WEBTOON URL helpers ───────────────────────────────────────────────────

function findWebtoonUrl(externalLinks) {
  if (!externalLinks?.length) return null;
  for (const { url } of externalLinks) {
    if (!url) continue;
    // English originals only — skip canvas/challenge (fan-made)
    if (url.includes('webtoons.com/en/') &&
        !url.includes('/canvas/') &&
        !url.includes('/challenge/')) {
      return url;
    }
  }
  return null;
}

function parseWebtoonUrl(url) {
  // https://www.webtoons.com/en/[genre]/[slug]/list?title_no=XXXX
  const pathMatch = url.match(/webtoons\.com\/en\/([^/?#]+)\/([^/?#]+)/);
  if (!pathMatch) return null;
  const [, genre, slug] = pathMatch;
  const tnMatch = url.match(/[?&]title_no=(\d+)/);
  return { genre, slug, titleNo: tnMatch ? parseInt(tnMatch[1]) : null };
}

// ─── WEBTOON RSS: get update_day ───────────────────────────────────────────

async function fetchRssDay(genre, slug, titleNo) {
  const rssUrl = `https://www.webtoons.com/en/${genre}/${slug}/rss?title_no=${titleNo}`;
  try {
    const res = await fetch(rssUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml',
      },
    });
    if (!res.ok) return { error: `RSS HTTP ${res.status}` };

    const xml = await res.text();
    const pubDateMatch = xml.match(/<pubDate>([^<]+)<\/pubDate>/);
    if (!pubDateMatch) return { error: 'No pubDate in RSS' };

    const date = new Date(pubDateMatch[1]);
    if (isNaN(date.getTime())) return { error: `Unparseable date: ${pubDateMatch[1]}` };

    // Convert UTC → KST to get the correct release day
    const kst = new Date(date.getTime() + KST_OFFSET_MS);
    return { updateDay: kst.getUTCDay(), hourKST: kst.getUTCHours() };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── Main ──────────────────────────────────────────────────────────────────

async function run() {
  console.log('Reading Tier 1 candidates from DISCOVERY_REPORT.md...');
  const tier1 = parseTier1(REPORT_PATH);
  console.log(`Found ${tier1.length} Tier 1 candidates.`);

  const existingIds   = new Set(seriesData.map(s => s.anilist_id).filter(Boolean));
  const existingSlugs = new Set(seriesData.map(s => s.id));

  const toProcess = tier1.filter(c => !existingIds.has(c.anilist_id));
  console.log(`${toProcess.length} not yet in series-data.json.\n`);

  if (toProcess.length === 0) { console.log('Nothing to add.'); process.exit(0); }

  // ── Step 2: Re-fetch externalLinks + status from AniList ──────────────────
  console.log('Fetching externalLinks from AniList...');
  const allIds = toProcess.map(c => c.anilist_id);
  const detailsMap = {};
  const batches = chunk(allIds, 50);

  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`  Batch ${i + 1}/${batches.length}...`);
    const results = await fetchAniListDetails(batches[i]);
    for (const m of results) detailsMap[m.id] = m;
    console.log(` ${results.length} results`);
    if (i < batches.length - 1) await sleep(DELAY_MS);
  }

  // ── Step 3–4: Process each candidate ─────────────────────────────────────
  const autoAdded   = [];
  const needsManual = [];
  const noWebtoon   = [];
  let rssCount      = 0;

  for (const candidate of toProcess) {
    const details = detailsMap[candidate.anilist_id];

    if (!details) {
      needsManual.push({ ...candidate, issue: 'Not returned by AniList' });
      continue;
    }

    // Skip non-releasing series
    if (['HIATUS', 'FINISHED', 'CANCELLED'].includes(details.status)) {
      console.log(`  ⏭  Skipping ${candidate.title} (${details.status})`);
      continue;
    }

    const webtoonUrl = findWebtoonUrl(details.externalLinks);
    if (!webtoonUrl) {
      noWebtoon.push({ ...candidate, issue: 'No WEBTOON original link on AniList' });
      continue;
    }

    const parsed = parseWebtoonUrl(webtoonUrl);
    if (!parsed?.titleNo) {
      needsManual.push({ ...candidate, webtoonUrl, issue: 'No title_no in WEBTOON URL' });
      continue;
    }

    const { genre: wtGenre, slug: wtSlug, titleNo } = parsed;

    // Delay before each RSS fetch
    if (rssCount > 0) await sleep(DELAY_MS);
    process.stdout.write(`  RSS  ${candidate.title}...`);
    const rss = await fetchRssDay(wtGenre, wtSlug, titleNo);
    rssCount++;

    if (!rss || rss.error) {
      console.log(` ❌ ${rss?.error ?? 'null'}`);
      needsManual.push({ ...candidate, webtoonUrl, issue: rss?.error ?? 'RSS returned null' });
      continue;
    }

    const { updateDay, hourKST } = rss;
    console.log(` ✅ ${DAYS[updateDay]} ${String(hourKST).padStart(2, '0')}:00 KST`);

    const titleEn = details.title?.english ?? candidate.title;
    const slug = slugify(titleEn);

    if (existingSlugs.has(slug)) {
      console.log(`    ⚠  Slug '${slug}' already exists — skipping`);
      continue;
    }

    const genres = candidate.genres ?? [];
    const entry = {
      id: slug,
      title: titleEn,
      title_kr: candidate.title_kr || null,
      anilist_id: candidate.anilist_id,
      platform: 'webtoon',
      platform_label: 'WEBTOON',
      read_url: webtoonUrl,
      update_day: updateDay,
      update_day_name: DAYS[updateDay],
      release_hour_kst: hourKST,
      on_hiatus: false,
      genre: mapGenre(genres),
      tags: genres.map(g => g.toLowerCase()),
      amazon_vol1: null,
      seo_description: `${titleEn} drops every ${DAYS[updateDay]} on WEBTOON. Live countdown to the next episode.`,
    };

    autoAdded.push(entry);
    existingSlugs.add(slug);
  }

  // ── Step 5: Write output files ───────────────────────────────────────────
  fs.writeFileSync(OUTPUT_PATH, JSON.stringify(autoAdded, null, 2) + '\n');

  let md = `# Batch Add — Manual Verification Required\n\nGenerated: ${new Date().toISOString()}\n\n`;

  if (needsManual.length > 0) {
    md += `## RSS failed or ambiguous\n\nVerify update day at the WEBTOON URL, then add stub to series-data.json.\n\n`;
    md += `| Title | AniList ID | WEBTOON URL | Issue |\n|---|---|---|---|\n`;
    for (const s of needsManual) {
      md += `| ${s.title} | ${s.anilist_id} | ${s.webtoonUrl ?? 'N/A'} | ${s.issue} |\n`;
    }
    md += '\n';
  }

  if (noWebtoon.length > 0) {
    md += `## No WEBTOON link (AniList-only)\n\n`;
    md += `These series are not on WEBTOON or AniList doesn't link to it. Check for Tapas/MangaPlus manually.\n\n`;
    md += `| Title | AniList ID | AniList URL |\n|---|---|---|\n`;
    for (const s of noWebtoon) {
      md += `| ${s.title} | ${s.anilist_id} | https://anilist.co/manga/${s.anilist_id} |\n`;
    }
  }

  fs.writeFileSync(MANUAL_PATH, md);

  // ── Step 6: Merge into series-data.json ──────────────────────────────────
  if (autoAdded.length > 0) {
    const merged = [...seriesData, ...autoAdded];
    fs.writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2) + '\n');
    console.log('\nseries-data.json updated.');
  }

  console.log(`\n✅ Auto-added:           ${autoAdded.length} series`);
  console.log(`⚠️  Needs manual review:  ${needsManual.length} series (see scripts/batch-add-manual.md)`);
  console.log(`❌ No WEBTOON link found: ${noWebtoon.length} series`);
}

run().catch(err => {
  console.error('Batch add failed:', err.message);
  process.exit(1);
});
