#!/usr/bin/env node
// auto-update.js — checks AniList status for all series with anilist_id set.
// Auto-updates on_hiatus field when status changes. Exits 1 if changes were made
// (signals GitHub Action to commit), exits 0 if no changes.
//
// Safety: if the AniList title returned for an ID doesn't match our series title,
// we log a warning and skip the update to avoid corrupting data with a wrong ID.

import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const DATA_PATH = path.join(__dirname, '..', 'src', 'data', 'series-data.json');

const seriesData = require(DATA_PATH);

function chunk(arr, size) {
  const chunks = [];
  for (let i = 0; i < arr.length; i += size) chunks.push(arr.slice(i, i + size));
  return chunks;
}

async function fetchStatuses(ids) {
  const query = `
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: MANGA) {
          id
          status
          chapters
          title { english romaji native }
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

// Returns true if the AniList title is a plausible match for our series title.
// Compares significant words (length > 3) to catch partial matches despite
// subtitle differences or romanization variations.
function titlesMatch(ourTitle, anilistMedia) {
  const candidates = [
    anilistMedia.title.english,
    anilistMedia.title.romaji,
  ].filter(Boolean).map(t => t.toLowerCase());

  const ourWords = ourTitle.toLowerCase().split(/\s+/).filter(w => w.length > 3);
  if (ourWords.length === 0) return true; // too short to compare

  return candidates.some(candidate =>
    ourWords.some(word => candidate.includes(word))
  );
}

async function update() {
  const tracked = seriesData.filter(s => s.anilist_id !== null);
  if (tracked.length === 0) {
    console.log('No series with anilist_id to check.');
    process.exit(0);
  }

  const ids = tracked.map(s => s.anilist_id);
  const batches = chunk(ids, 50);

  const statusMap = {};
  for (const batch of batches) {
    const results = await fetchStatuses(batch);
    for (const m of results) statusMap[m.id] = m;
  }

  const changes = [];
  const warnings = [];

  const updated = seriesData.map(series => {
    if (!series.anilist_id) return series;

    const result = statusMap[series.anilist_id];
    if (!result) return series;

    // Sanity check: skip if AniList title doesn't match our series title
    if (!titlesMatch(series.title, result)) {
      const aniTitle = result.title.english ?? result.title.romaji ?? '?';
      warnings.push(`  ⚠  ${series.title} (id: ${series.anilist_id}) — AniList returned "${aniTitle}", skipping (likely wrong ID)`);
      return series;
    }

    const { status } = result;
    const title = result.title.english ?? result.title.romaji ?? series.title;

    let updated = { ...series };
    let hasChanges = false;

    // HIATUS or FINISHED → should be on_hiatus: true
    if ((status === 'HIATUS' || status === 'FINISHED' || status === 'CANCELLED') && !series.on_hiatus) {
      changes.push(`  ⏸  ${title}: ${status} → on_hiatus set to true`);
      updated.on_hiatus = true;
      hasChanges = true;
    }

    // RELEASING and was on_hiatus → resumed
    if (status === 'RELEASING' && series.on_hiatus) {
      changes.push(`  ▶  ${title}: RELEASING → on_hiatus set to false (resumed)`);
      updated.on_hiatus = false;
      hasChanges = true;
    }

    // Sync total_episodes from AniList — only increase, never decrease
    if (result.chapters && result.chapters > 0) {
      const current = series.total_episodes || 0;
      if (result.chapters > current) {
        updated.total_episodes = result.chapters;
        hasChanges = true;
        changes.push(`  📊 ${title}: episodes updated ${current} → ${result.chapters}`);
      }
    }

    return hasChanges ? updated : series;
  });

  if (warnings.length > 0) {
    console.log(`\nID mismatches detected — fix these in series-data.json (${warnings.length}):`);
    warnings.forEach(w => console.log(w));
    console.log('\nRun: node scripts/auto-discover.js to find correct IDs.');
  }

  if (changes.length === 0) {
    if (warnings.length === 0) {
      console.log('No status changes detected. All series are up to date.');
    }
    process.exit(0);
  }

  console.log(`\nStatus changes detected (${changes.length}):`);
  changes.forEach(c => console.log(c));

  fs.writeFileSync(DATA_PATH, JSON.stringify(updated, null, 2) + '\n');
  console.log('\nseries-data.json updated.');

  // Exit code 1 signals the GitHub Action to commit the changes
  process.exit(1);
}

update().catch(err => {
  console.error('Status update failed:', err.message);
  process.exit(2);
});
