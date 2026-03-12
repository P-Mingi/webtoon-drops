#!/usr/bin/env node
// add-tapas-mangaplus.js — adds Tapas + MangaPlus series from manual backlog.
// Tapas: fetches RSS to determine update_day.
// MangaPlus: fetches AniList externalLinks to get real URL; update_day = null (no RSS).

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'src', 'data', 'series-data.json');
const seriesData = require(DATA_PATH);

const DELAY_MS = 1200;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }
function slugify(t) { return t.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, ''); }

// ─── Source data ───────────────────────────────────────────────────────────────

const TAPAS = [
  { slug: 'villains-are-destined-to-die',         title: 'Villains Are Destined to Die',         anilist_id: 118408, genre: 'Romance'  },
  { slug: 'overgeared',                            title: 'Overgeared',                           anilist_id: 117460, genre: 'Fantasy'  },
  { slug: 'latna-saga-survival-of-a-sword-king',   title: 'Latna Saga: Survival of a Sword King', anilist_id: 114605, genre: 'Fantasy'  },
  { slug: 'the-sss-ranker-returns',                title: 'The SSS-Ranker Returns',               anilist_id: 153883, genre: 'Action'   },
  { slug: 'the-archmage-returns-after-4000-years', title: 'The Archmage Returns After 4000 Years',anilist_id: 118424, genre: 'Fantasy'  },
  { slug: 'the-max-level-hero-strikes-back',       title: 'The Max Level Hero Strikes Back',      anilist_id: 125636, genre: 'Fantasy'  },
  { slug: 'the-legendary-spearman-returns',        title: 'The Legendary Spearman Returns',       anilist_id: 141479, genre: 'Action'   },
  { slug: 'rankers-return',                        title: "Ranker's Return",                      anilist_id: 137969, genre: 'Action'   },
  { slug: 'i-am-the-real-one',                     title: 'I Am the Real One',                    anilist_id: 124783, genre: 'Romance'  },
  { slug: 'semantic-error',                        title: 'Semantic Error',                       anilist_id: 125167, genre: 'Romance'  },
  { slug: 'the-male-leads-little-lion-daughter',   title: "The Male Lead's Little Lion Daughter", anilist_id: 138363, genre: 'Romance'  },
  { slug: 'not-sew-wicked-stepmom',                title: 'Not-Sew-Wicked Stepmom',               anilist_id: 132359, genre: 'Romance'  },
  { slug: 'beware-the-villainess',                 title: 'Beware the Villainess!',               anilist_id: 117540, genre: 'Romance'  },
  { slug: 'my-life-as-an-internet-novel',          title: 'My Life as an Internet Novel',         anilist_id: 110059, genre: 'Romance'  },
  { slug: 'doctor-live-again',                     title: 'Doctor, Live Again',                   anilist_id: 129579, genre: 'Drama'    },
  { slug: 'author-of-my-own-destiny',              title: 'Author of My Own Destiny',             anilist_id: 138655, genre: 'Romance'  },
];

const MANGAPLUS = [
  { title: 'Pick Me Up',                        anilist_id: 159441, genre: 'Action'   },
  { title: 'The Infinite Mage',                 anilist_id: 159930, genre: 'Fantasy'  },
  { title: 'God of Blackfield',                 anilist_id: 118267, genre: 'Action'   },
  { title: 'Player',                            anilist_id: 119363, genre: 'Action'   },
  { title: 'Tyrant of the Tower Defense Game',  anilist_id: 153513, genre: 'Fantasy'  },
];

// ─── Tapas RSS ─────────────────────────────────────────────────────────────────

async function fetchTapasRssDay(tapasSlug) {
  const url = `https://tapas.io/series/${tapasSlug}/rss`;
  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36',
        'Accept': 'application/rss+xml, application/xml, text/xml, */*',
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    const xml = await res.text();
    const m = xml.match(/<pubDate>([^<]+)<\/pubDate>/);
    if (!m) return { error: 'No pubDate in RSS' };
    const date = new Date(m[1]);
    if (isNaN(date.getTime())) return { error: `Unparseable date: ${m[1]}` };
    const kst = new Date(date.getTime() + KST_OFFSET_MS);
    return { updateDay: kst.getUTCDay(), hourKST: kst.getUTCHours() };
  } catch (err) {
    return { error: err.message };
  }
}

// ─── AniList: fetch externalLinks for MangaPlus series ─────────────────────────

async function fetchExternalLinks(ids) {
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

function findMangaPlusUrl(externalLinks) {
  if (!externalLinks?.length) return null;
  for (const { url } of externalLinks) {
    if (url?.includes('mangaplus.shueisha.co.jp')) return url;
  }
  return null;
}

// ─── Main ──────────────────────────────────────────────────────────────────────

async function run() {
  const existingIds   = new Set(seriesData.map(s => s.anilist_id).filter(Boolean));
  const existingSlugs = new Set(seriesData.map(s => s.id));
  const added = [];
  const skipped = [];

  // ── Tapas ─────────────────────────────────────────────────────────────────

  console.log(`\nProcessing ${TAPAS.length} Tapas series...\n`);

  for (let i = 0; i < TAPAS.length; i++) {
    const s = TAPAS[i];
    const id = slugify(s.title);

    if (existingIds.has(s.anilist_id) || existingSlugs.has(id)) {
      console.log(`  ⏭  Skipping ${s.title} (already in data)`);
      skipped.push(s.title);
      continue;
    }

    if (i > 0) await sleep(DELAY_MS);
    process.stdout.write(`  RSS  ${s.title}...`);
    const rss = await fetchTapasRssDay(s.slug);

    let updateDay   = null;
    let updateDayName = null;
    let releaseHour = 0;

    if (rss.error) {
      console.log(` ⚠  ${rss.error} → SCHEDULE TBD`);
    } else {
      updateDay = rss.updateDay;
      updateDayName = DAYS[rss.updateDay];
      releaseHour = rss.hourKST;
      console.log(` ✅ ${DAYS[rss.updateDay]} ${String(rss.hourKST).padStart(2, '0')}:00 KST`);
    }

    added.push({
      id,
      title: s.title,
      title_kr: null,
      anilist_id: s.anilist_id,
      platform: 'tapas',
      platform_label: 'TAPAS',
      read_url: `https://tapas.io/series/${s.slug}/info`,
      update_day: updateDay,
      update_day_name: updateDayName,
      release_hour_kst: releaseHour,
      on_hiatus: false,
      genre: s.genre,
      tags: [s.genre.toLowerCase()],
      amazon_vol1: null,
      seo_description: updateDay !== null
        ? `${s.title} releases every ${DAYS[updateDay]} on Tapas. Live countdown to the next episode.`
        : `${s.title} releases on Tapas. Live countdown to the next episode.`,
    });

    existingIds.add(s.anilist_id);
    existingSlugs.add(id);
  }

  // ── MangaPlus ──────────────────────────────────────────────────────────────

  console.log(`\nProcessing ${MANGAPLUS.length} MangaPlus series...\n`);

  await sleep(DELAY_MS);
  const mpIds = MANGAPLUS.map(s => s.anilist_id);
  const mpDetails = await fetchExternalLinks(mpIds);
  const mpMap = {};
  for (const m of mpDetails) mpMap[m.id] = m;

  for (const s of MANGAPLUS) {
    const id = slugify(s.title);

    if (existingIds.has(s.anilist_id) || existingSlugs.has(id)) {
      console.log(`  ⏭  Skipping ${s.title} (already in data)`);
      skipped.push(s.title);
      continue;
    }

    const details = mpMap[s.anilist_id];

    if (details && ['HIATUS', 'FINISHED', 'CANCELLED'].includes(details.status)) {
      console.log(`  ⏭  Skipping ${s.title} (AniList: ${details.status})`);
      skipped.push(s.title);
      continue;
    }

    const mpUrl = details ? findMangaPlusUrl(details.externalLinks) : null;
    const readUrl = mpUrl ?? `https://anilist.co/manga/${s.anilist_id}`;

    if (mpUrl) {
      console.log(`  ✅ ${s.title} → ${mpUrl}`);
    } else {
      console.log(`  ⚠  ${s.title} → no MangaPlus URL on AniList, using AniList page as placeholder`);
    }

    added.push({
      id,
      title: s.title,
      title_kr: null,
      anilist_id: s.anilist_id,
      platform: 'mangaplus',
      platform_label: 'MANGA PLUS',
      read_url: readUrl,
      update_day: null,
      update_day_name: null,
      release_hour_kst: 0,
      on_hiatus: false,
      genre: s.genre,
      tags: [s.genre.toLowerCase()],
      amazon_vol1: null,
      seo_description: `${s.title} releases on MANGA PLUS. Live countdown to the next episode.`,
    });

    existingIds.add(s.anilist_id);
    existingSlugs.add(id);
  }

  // ── Merge ──────────────────────────────────────────────────────────────────

  if (added.length > 0) {
    const merged = [...seriesData, ...added];
    fs.writeFileSync(DATA_PATH, JSON.stringify(merged, null, 2) + '\n');
  }

  const tapasWithDay   = added.filter(s => s.platform === 'tapas' && s.update_day !== null).length;
  const tapasNoDay     = added.filter(s => s.platform === 'tapas' && s.update_day === null).length;
  const mpAdded        = added.filter(s => s.platform === 'mangaplus').length;

  console.log(`\n✅ Added ${added.length} series total:`);
  console.log(`   Tapas with update_day:   ${tapasWithDay}`);
  console.log(`   Tapas SCHEDULE TBD:      ${tapasNoDay}`);
  console.log(`   MangaPlus (all TBD):     ${mpAdded}`);
  if (skipped.length) console.log(`⏭  Skipped (already in data): ${skipped.length}`);
}

run().catch(err => {
  console.error('Failed:', err.message);
  process.exit(1);
});
