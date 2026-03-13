#!/usr/bin/env node
// sync-episode-counts.js — one-time bulk fill of total_episodes from AniList.
// Safe to re-run: skips series that already have total_episodes set.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const ANILIST_API = 'https://graphql.anilist.co';

async function fetchChapterCounts(ids) {
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, type: MANGA) {
          id
          chapters
          status
          title { english romaji }
        }
      }
    }
  `;

  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { ids } })
  });

  if (!response.ok) throw new Error(`AniList error: ${response.status}`);
  const data = await response.json();
  return data.data?.Page?.media || [];
}

async function main() {
  const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // Fetch for all series with anilist_id that don't already have total_episodes set
  const toFetchAll = series.filter(s =>
    s.anilist_id &&
    (s.total_episodes === undefined || s.total_episodes === null)
  );

  console.log(`Fetching episode counts for ${toFetchAll.length} series...`);
  console.log(`Already set (manual): ${series.length - toFetchAll.length} series\n`);

  // Batch into groups of 50 (AniList page limit)
  const batches = [];
  for (let i = 0; i < toFetchAll.length; i += 50) {
    batches.push(toFetchAll.slice(i, i + 50).map(s => s.anilist_id));
  }

  const results = new Map(); // anilist_id → chapters

  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`  Batch ${i + 1}/${batches.length}...`);
    const data = await fetchChapterCounts(batches[i]);
    for (const item of data) {
      if (item.chapters) {
        results.set(item.id, item.chapters);
      }
    }
    console.log(` ${data.filter(d => d.chapters).length} with chapter counts`);
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 700));
  }

  let updated = 0;
  let skipped = 0;

  const updatedSeries = series.map(s => {
    // Never overwrite manually set data
    if (s.total_episodes !== undefined && s.total_episodes !== null) {
      return s;
    }

    const chapters = results.get(s.anilist_id);
    if (chapters && chapters > 0) {
      updated++;
      return { ...s, total_episodes: chapters };
    }

    skipped++;
    return s;
  });

  writeFileSync(DATA_PATH, JSON.stringify(updatedSeries, null, 2) + '\n');

  console.log(`\n✅ Done:`);
  console.log(`  Updated: ${updated} series`);
  console.log(`  Skipped (no AniList chapters data): ${skipped} series`);
  console.log(`  Already set (manual): ${series.length - toFetchAll.length} series`);

  const stillMissing = updatedSeries.filter(s =>
    s.total_episodes === undefined || s.total_episodes === null
  );
  if (stillMissing.length > 0) {
    console.log(`\n⚠️  Still missing total_episodes (set manually if known):`);
    stillMissing.forEach(s => console.log(`  - ${s.title} (${s.id})`));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
