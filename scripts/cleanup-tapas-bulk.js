#!/usr/bin/env node
// cleanup-tapas-bulk.js
// Removes false positive Tapas merges and the duplicate lion-daughter entry
// created by the sitemap-based scrape-tapas.js run.
//
// Actions:
//   1. DELETE entire entry: 'the-male-leads-little-lion-daughter' (duplicate of the-male-lead-s-little-lion-daughter)
//   2. STRIP Tapas platform from: all-you-need-is-perfection (wrong slug: all-you-need-is-love)
//   3. STRIP Tapas platform from: the-spark-in-your-eyes (wrong slug: the-stars-in-your-eyes)
//   4. STRIP Tapas platform from: nocturne (wrong slug: nocturne-21)
//
// Run: node scripts/cleanup-tapas-bulk.js

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
const before = data.length;

// ── 1. Remove duplicate entry ─────────────────────────────────────────────
const DELETE_IDS = new Set(['the-male-leads-little-lion-daughter']);

// ── 2. Strip wrong Tapas platform from these series IDs ──────────────────
const STRIP_TAPAS_FROM = new Set([
  'all-you-need-is-perfection',
  'the-spark-in-your-eyes',
  'nocturne',
]);

let deleted = 0;
let stripped = 0;

const cleaned = data
  .filter(s => {
    if (DELETE_IDS.has(s.id)) {
      console.log(`  🗑  Deleted: ${s.id}`);
      deleted++;
      return false;
    }
    return true;
  })
  .map(s => {
    if (!STRIP_TAPAS_FROM.has(s.id)) return s;

    const before = s.platforms ?? [];
    const after = before.filter(p => p.platform !== 'tapas');

    if (before.length === after.length) {
      console.log(`  ⚠  ${s.id} — no Tapas entry found to strip`);
      return s;
    }

    console.log(`  ✂  Stripped Tapas from: ${s.id}`);
    stripped++;

    // If only one platform remains, restore flat fields
    const updated = { ...s, platforms: after };
    if (after.length === 1) {
      updated.platform = after[0].platform;
      updated.platform_label = after[0].label;
      updated.read_url = after[0].read_url;
    }
    return updated;
  });

writeFileSync(DATA_PATH, JSON.stringify(cleaned, null, 2));

console.log('\n' + '═'.repeat(50));
console.log('CLEANUP COMPLETE');
console.log('═'.repeat(50));
console.log(`  Before: ${before} entries`);
console.log(`  Deleted (duplicates):           ${deleted}`);
console.log(`  Tapas stripped (false positives): ${stripped}`);
console.log(`  After:  ${cleaned.length} entries`);
