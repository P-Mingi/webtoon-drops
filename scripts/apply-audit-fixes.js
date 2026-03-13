#!/usr/bin/env node
// apply-audit-fixes.js — applies all fixes from the URL audit report
// Run: node scripts/apply-audit-fixes.js

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

let changed = 0;

function fix(id, updates, description) {
  const idx = data.findIndex(s => s.id === id);
  if (idx === -1) { console.log(`  ⚠  NOT FOUND: ${id}`); return; }
  Object.assign(data[idx], updates);
  // Keep platforms[] in sync if read_url changed
  if (updates.read_url !== undefined && data[idx].platforms?.length) {
    const platform = data[idx].platform;
    data[idx].platforms = data[idx].platforms.map(p =>
      p.platform === platform ? { ...p, read_url: updates.read_url } : p
    );
  }
  // Keep platforms[] in sync if platform changed
  if (updates.platform !== undefined && updates.read_url !== undefined) {
    data[idx].platforms = [{
      platform: updates.platform,
      label: updates.platform_label ?? updates.platform.toUpperCase(),
      read_url: updates.read_url,
    }];
  }
  console.log(`  ✅ ${id}: ${description}`);
  changed++;
}

function remove(id, description) {
  const idx = data.findIndex(s => s.id === id);
  if (idx === -1) { console.log(`  ⚠  NOT FOUND: ${id}`); return; }
  data.splice(idx, 1);
  console.log(`  🗑  ${id}: ${description}`);
  changed++;
}

console.log('Applying audit fixes…\n');

// ── GROUP 1: Series removed/suspended ─────────────────────────────────────
fix('lets-play', {
  on_hiatus: true,
  update_day: null,
  update_day_name: null,
  read_url: 'https://www.webtoons.com/en/romance/letsplay/list?title_no=1218',
}, 'series removed from WEBTOON Sep 2025 → on_hiatus');

fix('windbreaker', {
  on_hiatus: true,
  update_day: null,
  update_day_name: null,
}, 'series suspended Jul 2025 (plagiarism) → on_hiatus');

// ── GROUP 2: Title renames (URL is correct, stored title was old fan-translation) ───
fix('return-of-the-mount-hua-sect', {
  title: 'Return of the Blossoming Blade',
}, 'title updated to WEBTOON official English title');

fix('reborn-rich', {
  title: 'Reborn Rich',
}, 'remove long subtitle — WEBTOON title is just "Reborn Rich"');

fix('the-s-classes-that-i-raised', {
  title: 'My S-Class Hunters',
}, 'WEBTOON official English title is "My S-Class Hunters"');

fix('the-outcast-is-a-fighter', {
  title: 'The Outcast is a Fighter',
}, 'stored title was fan-translation; WEBTOON title is "The Outcast is a Fighter"');

fix('a-dance-of-swords-in-the-night', {
  title: 'A Dance of Swords in the Night',
}, 'stored title was fan-translation; WEBTOON official title applied');

fix('best-teacher-baek', {
  title: 'Best Teacher Baek',
}, 'stored title was fan-translation; WEBTOON title is "Best Teacher Baek"');

fix('the-perfect-hybrid', {
  title: 'The Perfect Hybrid',
}, 'stored title was fan-translation; WEBTOON title is "The Perfect Hybrid"');

fix('designated-bully', {
  title: 'Designated Bully',
}, 'stored title was fan-translation; WEBTOON title is "Designated Bully"');

// ── GROUP 3: Duplicate — my-s-class-hunters is the canonical entry ─────────
// First update my-s-class-hunters to have the correct title
fix('my-s-class-hunters', {
  title: 'My S-Class Hunters',
}, 'canonical entry — title normalised');

// Then delete the duplicate the-s-classes-that-i-raised
remove('the-s-classes-that-i-raised', 'duplicate of my-s-class-hunters (same URL title_no=3963)');

// ── GROUP 4: Wrong Tapas slugs ─────────────────────────────────────────────
fix('talent-swallowing-magician', {
  read_url: 'https://tapas.io/series/Talent-Swallowing-magician/info',
  platform: 'tapas',
  platform_label: 'TAPAS',
}, 'old URL pointed to wrong series (Demon Devourer); correct Tapas slug applied');

fix('magic-emperor', {
  read_url: 'https://tapas.io/series/magic-emperor/info',
}, 'lowercase slug — /Magic-Emperor/ was returning community page');

fix('ranker-s-return', {
  read_url: 'https://tapas.io/series/rankers-return-manhwa/info',
}, 'old URL was for the novel; -manhwa suffix targets the comic');

// ── GROUP 5: Wrong platform — should be Manta ─────────────────────────────
fix('under-the-oak-tree', {
  platform: 'manta',
  platform_label: 'MANTA',
  read_url: 'https://manta.net/series/1250',
}, 'moved from Tapas → Manta (manta.net/series/1250)');

fix('semantic-error', {
  platform: 'manta',
  platform_label: 'MANTA',
  read_url: 'https://manta.net/series/semantic-error',
}, 'series is on Manta, not Tapas');

// ── GROUP 6: The Live — URL was for Under the Oak Tree (wrong ID) ──────────
fix('the-live', {
  read_url: null,
  platform: 'webtoon',
  platform_label: 'WEBTOON',
  on_hiatus: true,
}, '"The Live" had Under the Oak Tree\'s Manta URL — nulled pending correct URL');

// ── GROUP 7: Tappytoon wrong slug ─────────────────────────────────────────
fix('the-skeleton-soldier-failed-to-defend-the-dungeon', {
  read_url: 'https://www.tappytoon.com/en/book/skeleton-soldier-failed-defend-dungeon',
}, 'corrected Tappytoon slug (was returning homepage)');

// ── SAVE ──────────────────────────────────────────────────────────────────
writeFileSync(DATA_PATH, JSON.stringify(data, null, 2));
console.log(`\n✅ ${changed} changes applied. Series count: ${data.length}`);
