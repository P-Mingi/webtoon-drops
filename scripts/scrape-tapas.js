#!/usr/bin/env node
/**
 * scrape-tapas.js
 *
 * Strategy:
 *  1. Download Tapas sitemap-comic.xml to get all ~44k series slugs (no rate limit, single fetch)
 *  2. For each of our existing 970 series, fuzzy-match against Tapas slugs
 *  3. Fetch detail page only for matches (~50-100 expected) to verify + get metadata
 *  4. Merge as additional platform entry in the platforms[] array
 *  5. Also process a curated list of known Tapas-exclusive manhwa originals
 *
 * Run: node scripts/scrape-tapas.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));

const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function fetchHtml(url) {
  return execSync(
    `curl -s -L --max-time 20 -H "User-Agent: ${UA}" -H "Accept-Language: en-US,en;q=0.9" "${url}"`,
    { maxBuffer: 20 * 1024 * 1024 }
  ).toString();
}

// ── Slug normalisation for fuzzy matching ────────────────────────────────────
function normSlug(s) {
  return s.toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}

// Compute word-overlap similarity between two slugs (hyphen-split words)
function slugSimilarity(a, b) {
  const wa = new Set(a.split('-').filter(w => w.length > 2));
  const wb = new Set(b.split('-').filter(w => w.length > 2));
  if (!wa.size) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / Math.max(wa.size, wb.size);
}

// ── Extract detail from a Tapas series /info page ───────────────────────────
function parseTapasDetail(html, slug) {
  // Title (strip "Read ... | Tapas Web Comics")
  const titleM = html.match(/<meta property="og:title" content="([^"]+)"/);
  let title = titleM?.[1]?.trim() ?? '';
  title = title.replace(/^Read\s+/i, '').replace(/\s*\|\s*Tapas.*$/i, '').trim();

  // Cover
  const coverM = html.match(/<meta property="og:image" content="([^"]+)"/);
  const cover_url = coverM?.[1]?.trim() ?? null;

  // Update day
  const schedM = html.match(/[Uu]pdates?\s+(?:every\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
  let update_day = null;
  let update_day_name = null;
  if (schedM) {
    const DAY_NUM = { sunday: 0, monday: 1, tuesday: 2, wednesday: 3, thursday: 4, friday: 5, saturday: 6 };
    const dayLow = schedM[1].toLowerCase();
    update_day = DAY_NUM[dayLow] ?? null;
    update_day_name = schedM[1].charAt(0).toUpperCase() + dayLow.slice(1);
  }

  // Completed / hiatus
  const completed = html.includes('COMPLETED') || html.includes('"completed"');
  const on_hiatus = html.includes('ON HIATUS') || html.includes('"on_hiatus"');

  // Genre from og:description or meta
  const genreM = html.match(/genre[^>]*>\s*([A-Za-z\s\-]+)\s*</i);
  const genre = genreM?.[1]?.trim() ?? null;

  return { title, cover_url, update_day, update_day_name, completed, on_hiatus, genre };
}

// ── Known Tapas-exclusive manhwa series to add if not already present ────────
// These are popular series known to be Tapas Originals or Tapas-exclusive
const TAPAS_EXCLUSIVE_SLUGS = [
  'overgeared',
  'second-life-ranker',
  'the-archmage-returns-after-4000-years',
  'rankers-return-reign-of-the-no-1-undead',
  'the-legendary-spearman-returns',
  'latna-saga-survival-of-a-sword-king',
  'i-am-the-real-one',
  'not-sew-wicked-stepmom',
  'beware-the-villainess',
  'my-life-as-an-internet-novel',
  'author-of-my-own-destiny',
  'semantic-error',
  'the-male-leads-little-lion-daughter',
  'doctor-elise-the-royal-lady-with-the-lamp',
  'the-sss-ranker-returns',
  'the-max-level-hero-strikes-back',
  'the-world-after-the-fall',
  'reality-quest',
];

async function main() {
  console.log('🕷️  Tapas Import — Sitemap-based matching\n');

  // ── Step 1: Fetch Tapas sitemap slugs ───────────────────────────────────────
  console.log('📥 Fetching Tapas sitemap-comic.xml (~5MB)…');
  const sitemap = fetchHtml('https://tapas.io/sitemap-comic.xml');
  const tapasSlugSet = new Set(
    [...sitemap.matchAll(/<loc>https:\/\/tapas\.io\/series\/([^<]+)<\/loc>/g)]
      .map(m => normSlug(m[1]))
  );
  console.log(`   ${tapasSlugSet.size} Tapas series slugs loaded`);

  // ── Step 2: Load our existing series ────────────────────────────────────────
  const existing = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  console.log(`   ${existing.length} series in series-data.json`);

  // ── Step 3: Match existing series against Tapas slugs ─────────────────────
  console.log('\n🔍 Matching existing series against Tapas slugs…\n');

  // Collect candidates: {ourId, tapasSlug, score}
  const candidates = [];
  const tapasSlugArr = [...tapasSlugSet];

  for (const s of existing) {
    // Skip if already has Tapas in platforms
    const hasTapas = s.platforms?.some(p => p.platform === 'tapas') || s.platform === 'tapas';
    if (hasTapas) continue;

    const ourSlug = normSlug(s.id);

    // Exact match first
    if (tapasSlugSet.has(ourSlug)) {
      candidates.push({ series: s, tapasSlug: ourSlug, score: 1.0 });
      continue;
    }

    // Fuzzy match — only check slugs that share the first word
    const firstWord = ourSlug.split('-')[0];
    const samePrefix = tapasSlugArr.filter(ts => ts.startsWith(firstWord));
    let best = null;
    let bestScore = 0;
    for (const ts of samePrefix) {
      const score = slugSimilarity(ourSlug, ts);
      if (score > bestScore) { bestScore = score; best = ts; }
    }
    if (best && bestScore >= 0.75) {
      candidates.push({ series: s, tapasSlug: best, score: bestScore });
    }
  }

  console.log(`   Found ${candidates.length} potential matches to verify`);

  // ── Step 4: Also add Tapas-exclusive slugs not yet in our data ─────────────
  const existingIds = new Set(existing.map(s => normSlug(s.id)));
  const newExclusives = TAPAS_EXCLUSIVE_SLUGS.filter(slug => {
    const norm = normSlug(slug);
    return tapasSlugSet.has(norm) && !existingIds.has(norm);
  });
  console.log(`   ${newExclusives.length} Tapas-exclusive series to add`);

  // ── Step 5: Fetch detail pages for all candidates + exclusives ─────────────
  console.log('\n🌐 Fetching Tapas detail pages…\n');

  const updatedExisting = existing.map(s => ({ ...s }));

  let merged = 0, added = 0, skipped = 0, failed = 0;

  // Process matches
  for (let i = 0; i < candidates.length; i++) {
    const { series, tapasSlug, score } = candidates[i];
    await sleep(600);

    const url = `https://tapas.io/series/${tapasSlug}/info`;
    process.stdout.write(`[${i+1}/${candidates.length}] ${tapasSlug.slice(0,45).padEnd(46)} (${(score*100).toFixed(0)}%) `);

    let detail;
    try {
      const html = fetchHtml(url);
      detail = parseTapasDetail(html, tapasSlug);
    } catch (e) {
      console.log(`✗ fetch error`);
      failed++;
      continue;
    }

    if (!detail.title) { console.log('✗ no title'); failed++; continue; }
    if (detail.completed) { console.log('⬜ completed'); skipped++; continue; }

    const idx = updatedExisting.findIndex(s => s.id === series.id);
    const s = updatedExisting[idx];

    const tapasEntry = { platform: 'tapas', label: 'TAPAS', read_url: url };
    const currentPlatforms = s.platforms ?? [{ platform: s.platform, label: s.platform_label ?? s.platform.toUpperCase(), read_url: s.read_url }];

    updatedExisting[idx] = {
      ...s,
      platforms: [...currentPlatforms, tapasEntry],
      // Fill missing cover if Tapas has one
      cover_url: s.cover_url || detail.cover_url,
      // Fill missing schedule if Tapas has it
      update_day:      s.update_day      != null ? s.update_day      : detail.update_day,
      update_day_name: s.update_day_name != null ? s.update_day_name : detail.update_day_name,
    };

    console.log(`✅ ${detail.title}`);
    merged++;
  }

  // Process Tapas-exclusive series
  for (let i = 0; i < newExclusives.length; i++) {
    const tapasSlug = newExclusives[i];
    await sleep(600);

    const url = `https://tapas.io/series/${tapasSlug}/info`;
    process.stdout.write(`[NEW ${i+1}/${newExclusives.length}] ${tapasSlug.slice(0,45).padEnd(46)} `);

    let detail;
    try {
      const html = fetchHtml(url);
      detail = parseTapasDetail(html, tapasSlug);
    } catch (e) {
      console.log(`✗ fetch error`);
      continue;
    }

    if (!detail.title) { console.log('✗ no title'); continue; }
    if (detail.completed) { console.log('⬜ completed'); continue; }

    const newId = normSlug(tapasSlug);
    const newEntry = {
      id: newId,
      title: detail.title,
      title_kr: null,
      anilist_id: null,
      platform: 'tapas',
      platform_label: 'TAPAS',
      read_url: url,
      update_day: detail.update_day,
      update_day_name: detail.update_day_name,
      release_hour_kst: 0,
      on_hiatus: detail.on_hiatus ?? false,
      genre: detail.genre || 'Action',
      tags: [],
      seo_description: `${detail.title} releases on Tapas. Live countdown to the next episode.`,
      platforms: [{ platform: 'tapas', label: 'TAPAS', read_url: url }],
      total_episodes: null,
      hiatus_history: [],
      cover_url: detail.cover_url,
      anilist_score: null,
    };

    updatedExisting.push(newEntry);
    existingIds.add(newId);
    console.log(`✅ ${detail.title} — added`);
    added++;
  }

  // ── Step 6: Save ─────────────────────────────────────────────────────────
  writeFileSync(DATA_PATH, JSON.stringify(updatedExisting, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('TAPAS IMPORT COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Merged (now multi-platform): ${merged}`);
  console.log(`  New Tapas-exclusive added:   ${added}`);
  console.log(`  Skipped (completed):         ${skipped}`);
  console.log(`  Failed:                      ${failed}`);
  console.log(`  Total series:                ${updatedExisting.length}`);
}

main().catch(console.error);
