#!/usr/bin/env node
// match-anilist.js — Suggests AniList IDs for series missing anilist_id.
// Prints suggestions only — DO NOT auto-assign. AniList titles often mismatch.
// Manually verify each suggestion before adding to series-data.json.
//
// Run: node scripts/match-anilist.js

import { readFileSync } from 'fs';

const DATA_PATH = new URL('../src/data/series-data.json', import.meta.url).pathname;
const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

const noAnilist = series.filter(s => !s.anilist_id && !s.on_hiatus);
console.log(`${noAnilist.length} series need AniList matching\n`);

if (noAnilist.length === 0) {
  console.log('✅ All active series already have anilist_id.');
  process.exit(0);
}

const sleep = ms => new Promise(r => setTimeout(r, ms));

async function searchAniList(title) {
  const query = `
    query ($search: String) {
      Page(page: 1, perPage: 3) {
        media(search: $search, type: MANGA, format_in: [MANHWA, MANGA]) {
          id
          title { romaji english }
          coverImage { large }
          meanScore
          status
          countryOfOrigin
        }
      }
    }
  `;
  const res = await fetch('https://graphql.anilist.co', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ query, variables: { search: title } }),
  });
  const data = await res.json();
  return data?.data?.Page?.media || [];
}

for (const s of noAnilist) {
  await sleep(700);
  try {
    const results = await searchAniList(s.title || s.id);
    if (results.length === 0) {
      console.log(`  ✗ No match: ${s.title || s.id}`);
      continue;
    }
    const best = results[0];
    const name = best.title.english || best.title.romaji;
    const flag = best.countryOfOrigin === 'KR' ? '🇰🇷' : best.countryOfOrigin === 'CN' ? '🇨🇳' : '🌐';
    console.log(`  ${flag} ${s.title || s.id}`);
    console.log(`     → "${name}" (ID: ${best.id}, score: ${best.meanScore}, status: ${best.status})`);
    if (results.length > 1) {
      const alt = results[1];
      const altName = alt.title.english || alt.title.romaji;
      console.log(`     alt: "${altName}" (ID: ${alt.id})`);
    }
  } catch (e) {
    console.error(`  ✗ Error for ${s.title}: ${e.message}`);
  }
}

console.log('\n⚠️  Review suggestions manually before adding anilist_id to series-data.json.');
