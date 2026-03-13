#!/usr/bin/env node
// fetch-covers.js — bulk fetch cover images + AniList scores without type filter.
// Uses alias queries to query each ID directly (bypasses manga/anime type mismatch).
// Flags series where AniList returns ANIME type — those need manual anilist_id fix.
// Safe to re-run.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const ANILIST_API = 'https://graphql.anilist.co';

// Query without type filter — returns the exact entry for that ID
async function fetchMediaBatch(seriesBatch) {
  const aliases = seriesBatch.map((s, i) => `
    m${i}: Media(id: ${s.anilist_id}) {
      id
      type
      coverImage { extraLarge large }
      meanScore
      title { english romaji native }
    }
  `).join('\n');

  const query = `{ ${aliases} }`;

  const response = await fetch(ANILIST_API, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query })
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`AniList error ${response.status}: ${text.slice(0, 200)}`);
  }

  const data = await response.json();

  if (data.errors) {
    console.warn('  AniList errors:', data.errors.map(e => e.message).join(', '));
  }

  const results = [];
  if (data.data) {
    for (const key of Object.keys(data.data)) {
      const item = data.data[key];
      if (item) results.push(item);
    }
  }
  return results;
}

async function main() {
  const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  const toFetch = series.filter(s => s.anilist_id);

  console.log(`Fetching covers + scores for ${toFetch.length} series...`);

  const BATCH_SIZE = 20;
  const batches = [];
  for (let i = 0; i < toFetch.length; i += BATCH_SIZE) {
    batches.push(toFetch.slice(i, i + BATCH_SIZE));
  }

  const results = new Map(); // anilist_id → { cover_url, anilist_score, type }

  for (let i = 0; i < batches.length; i++) {
    console.log(`\nBatch ${i + 1}/${batches.length} (${batches[i].length} series)...`);
    try {
      const data = await fetchMediaBatch(batches[i]);
      for (const item of data) {
        const cover = item.coverImage?.extraLarge || item.coverImage?.large || null;
        const score = item.meanScore || null;
        results.set(item.id, { cover_url: cover, anilist_score: score, type: item.type });
        const titleStr = item.title?.english || item.title?.romaji || '?';
        console.log(`  ✓ [${item.type}] ${titleStr} | score:${score ?? '—'} | cover:${cover ? 'yes' : 'no'}`);
      }
    } catch (err) {
      console.error(`  Batch ${i + 1} failed:`, err.message);
    }
    await new Promise(r => setTimeout(r, 800));
  }

  let updatedCovers = 0;
  let updatedScores = 0;
  let missing = 0;

  const updatedSeries = series.map(s => {
    const result = results.get(s.anilist_id);
    if (!result) {
      if (s.anilist_id) missing++;
      return s;
    }

    const updated = { ...s };
    if (result.cover_url) { updated.cover_url = result.cover_url; updatedCovers++; }
    if (result.anilist_score) { updated.anilist_score = result.anilist_score; updatedScores++; }
    return updated;
  });

  writeFileSync(DATA_PATH, JSON.stringify(updatedSeries, null, 2) + '\n');

  console.log(`\n✅ Done:`);
  console.log(`  Covers updated: ${updatedCovers}`);
  console.log(`  Scores updated: ${updatedScores}`);
  console.log(`  IDs not found in AniList: ${missing}`);

  const animeFlagged = updatedSeries.filter(s => results.get(s.anilist_id)?.type === 'ANIME');
  if (animeFlagged.length > 0) {
    console.log(`\n⚠️  These series have ANIME anilist_ids — covers may be wrong:`);
    animeFlagged.forEach(s => console.log(`  - ${s.title} (id: ${s.anilist_id})`));
    console.log(`  Fix: find the correct MANGA id at https://anilist.co and update series-data.json`);
  }
}

main().catch(err => {
  console.error('Fatal:', err);
  process.exit(1);
});
