#!/usr/bin/env node
// scrape-webtoon-originals.js
// Scrapes all active WEBTOON Original series from the 7 day pages,
// enriches each with title + cover from the series page, then merges
// new entries into series-data.json without overwriting existing manual data.
//
// Run: node scripts/scrape-webtoon-originals.js
// Takes ~15-25 min due to polite per-request delays.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const DAYS = ['monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday', 'sunday'];

// JS day convention: 0=Sun, 1=Mon … 6=Sat
const DAY_TO_NUMBER = {
  monday: 1, tuesday: 2, wednesday: 3, thursday: 4,
  friday: 5, saturday: 6, sunday: 0,
};
const DAY_NAMES = {
  monday: 'Monday', tuesday: 'Tuesday', wednesday: 'Wednesday',
  thursday: 'Thursday', friday: 'Friday', saturday: 'Saturday', sunday: 'Sunday',
};

const GENRE_MAP = {
  action: 'Action', romance: 'Romance', fantasy: 'Fantasy', drama: 'Drama',
  comedy: 'Comedy', supernatural: 'Supernatural', thriller: 'Thriller',
  'sci-fi': 'Sci-fi', mystery: 'Mystery', horror: 'Horror',
  'slice-of-life': 'Slice of Life', sports: 'Sports',
  historical: 'Historical', superhero: 'Superhero',
  'martial-arts': 'Martial Arts', informative: 'Informative',
};

const sleep = (ms) => new Promise(r => setTimeout(r, ms));

// Use curl — Node's fetch is blocked by WEBTOON's TLS fingerprint check.
function fetchPage(url, retries = 3) {
  for (let i = 0; i < retries; i++) {
    try {
      return execSync(
        `curl -s -L --max-time 30 -H "User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36" -H "Accept-Language: en-US,en;q=0.9" "${url}"`,
        { maxBuffer: 10 * 1024 * 1024 }
      ).toString();
    } catch (e) {
      if (i === retries - 1) throw new Error(`curl failed for ${url}: ${e.message}`);
      // sync sleep via spin-wait is ugly; use a tiny blocking approach
      const end = Date.now() + 2000 * (i + 1);
      while (Date.now() < end) {} // brief retry pause
    }
  }
}

function extractSeriesFromDayPage(html, day) {
  const series = [];
  const seen = new Set();

  // Match series URLs: /en/{genre}/{slug}/list?title_no={id}
  const urlPattern = /href="https:\/\/www\.webtoons\.com\/en\/([^\/]+)\/([^\/]+)\/list\?title_no=(\d+)"/g;
  let m;
  while ((m = urlPattern.exec(html)) !== null) {
    const [, genre, slug, titleNo] = m;
    if (genre === 'challenge' || genre === 'canvas') continue;
    if (seen.has(slug)) continue;
    seen.add(slug);

    const genreFormatted = GENRE_MAP[genre] || genre.charAt(0).toUpperCase() + genre.slice(1);
    const readUrl = `https://www.webtoons.com/en/${genre}/${slug}/list?title_no=${titleNo}`;

    series.push({
      id: slug,
      title: null,
      title_kr: null,
      anilist_id: null,
      platform: 'webtoon',
      platform_label: 'WEBTOON',
      read_url: readUrl,
      update_day: DAY_TO_NUMBER[day],
      update_day_name: DAY_NAMES[day],
      release_hour_kst: 0,
      on_hiatus: false,
      genre: genreFormatted,
      tags: [],
      seo_description: null,
      platforms: [{ platform: 'webtoon', label: 'WEBTOON', read_url: readUrl }],
      total_episodes: null,
      hiatus_history: [],
      cover_url: null,
      anilist_score: null,
      // no buy_links until manually verified
      _title_no: titleNo,
      _genre_slug: genre,
    });
  }

  return series;
}

async function scrapeSeriesDetail(s) {
  try {
    await sleep(800);
    const html = fetchPage(s.read_url);

    // Title from <title> tag
    const titleM = html.match(/<title>([^<|]+)/);
    if (titleM) {
      s.title = titleM[1].trim()
        .replace(/\s*[-|]\s*WEBTOON\s*$/i, '')
        .replace(/\s+/g, ' ')
        .trim();
    }

    // Cover from og:image
    const ogM = html.match(/<meta property="og:image" content="([^"]+)"/);
    if (ogM) s.cover_url = ogM[1];

    // Update day from page text (refine if different from day-page)
    const schedM = html.match(/[Uu]pdates?\s+(?:every\s+)?(Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday)/i);
    if (schedM) {
      const dayLower = schedM[1].toLowerCase();
      s.update_day = DAY_TO_NUMBER[dayLower] ?? s.update_day;
      s.update_day_name = DAY_NAMES[dayLower] ?? s.update_day_name;
    }

    // Completed / hiatus detection
    if (
      html.includes('ico_completed') ||
      html.includes('"COMPLETED"') ||
      html.includes('series_state:completed')
    ) {
      s._completed = true;
    }
    if (html.includes('ON HIATUS') || html.includes('series_state:hiatus')) {
      s.on_hiatus = true;
    }

    // Generate basic seo_description once we have a title
    if (s.title && !s.seo_description) {
      s.seo_description = `${s.title} drops every ${s.update_day_name} on WEBTOON. Live countdown to the next chapter.`;
    }

    console.log(`  ✓ ${s.title || s.id} — ${s.update_day_name}`);
    return s;
  } catch (e) {
    console.error(`  ✗ Failed ${s.id}: ${e.message}`);
    return s;
  }
}

async function main() {
  console.log('🕷️  Scraping WEBTOON Originals by day...\n');

  const allScraped = [];
  const seenIds = new Set();

  // Step 1: Collect series from each day page
  for (const day of DAYS) {
    console.log(`📅 ${day}...`);
    try {
      const html = fetchPage(
        `https://www.webtoons.com/en/originals/${day}`
      );
      const daySeries = extractSeriesFromDayPage(html, day);
      console.log(`   Found ${daySeries.length} series`);
      for (const s of daySeries) {
        if (!seenIds.has(s.id)) {
          seenIds.add(s.id);
          allScraped.push(s);
        }
      }
    } catch (e) {
      console.error(`   ✗ Failed to fetch ${day}: ${e.message}`);
    }
    await sleep(1500);
  }

  console.log(`\n📋 Total unique series found: ${allScraped.length}`);

  if (allScraped.length === 0) {
    console.log('\n⚠️  No series found — WEBTOON page may require JS rendering.');
    console.log('   The day pages might return 0 results from a plain fetch.');
    console.log('   Consider using Playwright/Puppeteer for JS-rendered content.');
    process.exit(0);
  }

  console.log('\n🔍 Fetching individual series pages...\n');

  // Step 2: Enrich each series with detail page data
  const detailed = [];
  for (let i = 0; i < allScraped.length; i++) {
    process.stdout.write(`[${i + 1}/${allScraped.length}] `);
    const enriched = await scrapeSeriesDetail(allScraped[i]);
    detailed.push(enriched);
  }

  // Step 3: Filter completed series
  const active = detailed.filter(s => !s._completed);
  const completed = detailed.filter(s => s._completed);
  console.log(`\n✅ Active: ${active.length} | Completed (skipped): ${completed.length}`);

  // Step 4: Merge with existing data
  const existing = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const existingIds = new Set(existing.map(s => s.id));

  const cleanSeries = (s) => {
    const clean = { ...s };
    delete clean._title_no;
    delete clean._genre_slug;
    delete clean._completed;
    return clean;
  };

  const newSeries = active
    .filter(s => !existingIds.has(s.id))
    .map(cleanSeries);

  // Update existing entries — only fill in missing fields, never overwrite
  const updatedExisting = existing.map(s => {
    const scraped = detailed.find(d => d.id === s.id);
    if (!scraped) return s;
    return {
      ...s,
      title:      s.title      || scraped.title,
      cover_url:  s.cover_url  || scraped.cover_url,
      // update_day: use existing unless it's null (0 is falsy but valid)
      update_day: s.update_day != null ? s.update_day : scraped.update_day,
    };
  });

  const merged = [...updatedExisting, ...newSeries];
  writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2));

  console.log('\n🎉 Done!');
  console.log(`   Existing: ${existing.length} | New added: ${newSeries.length} | Total: ${merged.length}`);

  if (newSeries.length > 0) {
    console.log('\n📝 New series (needs AniList ID + review):');
    newSeries.forEach(s => {
      console.log(`   • ${s.title || s.id} (${s.genre}) — ${s.update_day_name}`);
    });
    console.log('\n⚠️  Next steps:');
    console.log('   1. node scripts/match-anilist.js  → review AniList ID suggestions');
    console.log('   2. Manually add verified anilist_ids to series-data.json');
    console.log('   3. node scripts/fetch-covers.js   → fetch covers + scores');
    console.log('   4. npm run build');
  }
}

main().catch(console.error);
