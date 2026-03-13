#!/usr/bin/env node
// migrate-buy-links.js — Migrates amazon_vol1 → buy_links array schema.
// Safe to re-run: skips series that already have buy_links.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

let migrated = 0;
let skipped = 0;

const updated = series.map(s => {
  // Already migrated or no amazon_vol1 to migrate
  if (s.buy_links) { skipped++; return s; }
  if (!s.amazon_vol1) return s;

  const result = { ...s };
  result.buy_links = [
    {
      retailer: 'amazon_us',
      label: 'Amazon US',
      url: s.amazon_vol1,
      countries: ['US', 'CA', 'AU', 'default'],
    },
  ];
  delete result.amazon_vol1;
  migrated++;
  return result;
});

writeFileSync(DATA_PATH, JSON.stringify(updated, null, 2) + '\n');
console.log(`Migration complete: ${migrated} migrated, ${skipped} already had buy_links.`);
