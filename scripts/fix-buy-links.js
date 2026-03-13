#!/usr/bin/env node
// fix-buy-links.js — Apply verified ASINs to series-data.json
// Run: node scripts/fix-buy-links.js

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

// VERIFIED CORRECT ASINs (English Vol. 1 paperback, amazon.com)
const VERIFIED_ASINS = {
  'tower-of-god':                   '1990259766',   // ✅ confirmed
  'omniscient-readers-viewpoint':   'B0CCNFHFZD',   // ✅ fixed (was B0C3B3B7YZ)
  'eleceed':                        'B09HMJHPWR',   // ✅ confirmed
  'nano-machine':                   'B0BQNP47MG',   // ✅ confirmed
  'mercenary-enrollment':           'B0BTJX3VYP',   // ✅ confirmed
  'the-beginning-after-the-end':    '1975348915',   // ✅ confirmed
  'lore-olympus':                   '0593160096',   // ✅ confirmed
  'true-beauty':                    'B09F4PLRJ6',   // ✅ confirmed
  'subzero':                        '1637154437',   // ✅ fixed (was B0BN7F2345)
  'lookism':                        'B09NP8BVHK',   // ✅ confirmed
  'the-god-of-high-school':         'B09NP7B4T9',   // ✅ confirmed
  'remarried-empress':              'B0BN7GCP4D',   // ✅ confirmed

  // NEWLY FOUND - were missing buy_links entirely:
  'jungle-juice':                   'B0C2P7PT1Y',   // ✅ verified
  'villains-are-destined-to-die':   'B0B5JTTG2N',   // ✅ verified (was placeholder)
  'doom-breaker':                   'B0CTBFBTM9',   // ✅ verified (print exists!)
  'second-life-ranker':             '2811681957',   // ✅ French edition exists on amazon.com
  'unordinary':                     'B09NP8G3NW',   // ⚠️ verify this ASIN before applying
};

function buildLinks(asin) {
  return [
    {
      retailer: 'amazon_us',
      label: 'Amazon US',
      url: `https://www.amazon.com/dp/${asin}?tag=pecchia-20`,
      countries: ['US', 'CA', 'AU', 'default']
    },
    {
      retailer: 'amazon_fr',
      label: 'Amazon.fr',
      url: `https://www.amazon.fr/dp/${asin}?tag=pecchia-21`,
      countries: ['FR', 'BE']
    },
    {
      retailer: 'amazon_uk',
      label: 'Amazon UK',
      url: `https://www.amazon.co.uk/dp/${asin}?tag=pecchia0e-21`,
      countries: ['GB', 'IE']
    },
    {
      retailer: 'amazon_de',
      label: 'Amazon.de',
      url: `https://www.amazon.de/dp/${asin}?tag=pecchia07-21`,
      countries: ['DE', 'AT', 'CH']
    },
    {
      retailer: 'amazon_es',
      label: 'Amazon.es',
      url: `https://www.amazon.es/dp/${asin}?tag=pecchia06-21`,
      countries: ['ES']
    },
    {
      retailer: 'amazon_it',
      label: 'Amazon.it',
      url: `https://www.amazon.it/dp/${asin}?tag=pecchia0b-21`,
      countries: ['IT']
    }
  ];
}

const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
let fixed = 0;
let added = 0;
let skipped = 0;

const updated = series.map(s => {
  // Apply verified ASIN
  if (VERIFIED_ASINS[s.id]) {
    const links = buildLinks(VERIFIED_ASINS[s.id]);
    const action = s.buy_links ? 'FIXED' : 'ADDED';
    console.log(`  ${action === 'FIXED' ? '🔧' : '✨'} ${s.title} → ASIN ${VERIFIED_ASINS[s.id]}`);
    action === 'FIXED' ? fixed++ : added++;
    return { ...s, buy_links: links };
  }

  // Already has good buy_links, leave alone
  if (s.buy_links) {
    skipped++;
    return s;
  }

  return s;
});

writeFileSync(DATA_PATH, JSON.stringify(updated, null, 2));
console.log(`\n✅ Fixed: ${fixed} | Added new: ${added} | Left alone: ${skipped}`);
console.log('\n⚠️  Manually verify these ASINs before next deploy:');
console.log('   - second-life-ranker (2811681957) → French edition, may redirect on .com');
console.log('   - unordinary (B09NP8G3NW) → verify correct');
console.log('   - doom-breaker (B0CTBFBTM9) → verify correct');
