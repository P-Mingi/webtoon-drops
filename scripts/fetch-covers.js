#!/usr/bin/env node
// fetch-covers.js — bulk fetch cover images from AniList and store in series-data.json.
// Safe to re-run: refreshes all covers with latest AniList URLs.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const ANILIST_API = 'https://graphql.anilist.co';

async function fetchCovers(ids) {
  const query = `
    query ($ids: [Int]) {
      Page(perPage: 50) {
        media(id_in: $ids, type: MANGA) {
          id
          coverImage {
            extraLarge
            large
          }
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

  const toFetch = series.filter(s => s.anilist_id);
  console.log(`Fetching covers for ${toFetch.length} series...`);

  const batches = [];
  for (let i = 0; i < toFetch.length; i += 50) {
    batches.push(toFetch.slice(i, i + 50).map(s => s.anilist_id));
  }

  const results = new Map();

  for (let i = 0; i < batches.length; i++) {
    process.stdout.write(`  Batch ${i + 1}/${batches.length}...`);
    const data = await fetchCovers(batches[i]);
    for (const item of data) {
      const url = item.coverImage?.extraLarge || item.coverImage?.large;
      if (url) results.set(item.id, url);
    }
    console.log(` ${data.filter(d => d.coverImage?.extraLarge || d.coverImage?.large).length} covers`);
    if (i < batches.length - 1) await new Promise(r => setTimeout(r, 700));
  }

  let updated = 0;
  let missing = 0;

  const updatedSeries = series.map(s => {
    const url = results.get(s.anilist_id);
    if (url) {
      updated++;
      return { ...s, cover_url: url };
    }
    if (!s.cover_url && s.anilist_id) missing++;
    return s;
  });

  writeFileSync(DATA_PATH, JSON.stringify(updatedSeries, null, 2) + '\n');

  console.log(`\n✅ Done:`);
  console.log(`  Updated: ${updated} covers`);
  console.log(`  Still missing (no AniList data): ${missing}`);

  const noAnilist = series.filter(s => !s.anilist_id && !s.cover_url);
  if (noAnilist.length > 0) {
    console.log(`\n⚠️  No anilist_id AND no cover_url (need manual cover):`);
    noAnilist.forEach(s => console.log(`  - ${s.title}`));
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
