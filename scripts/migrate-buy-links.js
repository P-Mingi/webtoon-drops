#!/usr/bin/env node
// migrate-buy-links.js — Rebuilds buy_links with real affiliate tags + all 6 Amazon countries.
// Extracts ASIN from existing amazon_us URL when available.
// For series with only French search links (Pika Wavetoon), creates 6-country search links.
// Removes non-Amazon retailers (fnac, etc.) — Amazon only for now.
// Safe to re-run.

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const AMAZON_STORES = [
  { retailer: 'amazon_us', label: 'Amazon US',  tld: 'com',    tag: 'pecchia-20',   countries: ['US', 'CA', 'AU', 'default'] },
  { retailer: 'amazon_fr', label: 'Amazon.fr',  tld: 'fr',     tag: 'pecchia-21',   countries: ['FR', 'BE', 'CH'] },
  { retailer: 'amazon_uk', label: 'Amazon UK',  tld: 'co.uk',  tag: 'pecchia0e-21', countries: ['GB', 'IE'] },
  { retailer: 'amazon_de', label: 'Amazon.de',  tld: 'de',     tag: 'pecchia07-21', countries: ['DE', 'AT'] },
  { retailer: 'amazon_es', label: 'Amazon.es',  tld: 'es',     tag: 'pecchia06-21', countries: ['ES'] },
  { retailer: 'amazon_it', label: 'Amazon.it',  tld: 'it',     tag: 'pecchia0b-21', countries: ['IT'] },
];

function extractAsin(url) {
  if (!url) return null;
  return url.match(/\/(?:dp|gp\/product)\/([A-Z0-9]{10})/)?.[1] || null;
}

function extractSearchTerm(url) {
  if (!url) return null;
  const kMatch = url.match(/[?&]k=([^&]+)/);
  return kMatch ? decodeURIComponent(kMatch[1].replace(/\+/g, ' ')) : null;
}

function buildFromAsin(asin) {
  return AMAZON_STORES.map(store => ({
    retailer: store.retailer,
    label: store.label,
    url: `https://www.amazon.${store.tld}/dp/${asin}?tag=${store.tag}`,
    countries: store.countries,
  }));
}

function buildFromSearch(searchTerm) {
  const q = searchTerm.replace(/\s+/g, '+');
  return AMAZON_STORES.map(store => ({
    retailer: store.retailer,
    label: store.label,
    url: `https://www.amazon.${store.tld}/s?k=${q}&tag=${store.tag}`,
    countries: store.countries,
  }));
}

const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

let updated = 0;
let skipped = 0;

const migrated = series.map(s => {
  if (!s.buy_links) return s;

  // Try to extract ASIN from any existing Amazon link
  const amazonLinks = s.buy_links.filter(l => l.retailer?.startsWith('amazon_'));
  let asin = null;
  for (const link of amazonLinks) {
    asin = extractAsin(link.url);
    if (asin) break;
  }

  let newLinks;

  if (asin) {
    newLinks = buildFromAsin(asin);
    console.log(`  ✓ ${s.title}: ASIN ${asin} → 6 links`);
  } else {
    // Try to get search term from existing amazon link
    const searchTerm = extractSearchTerm(amazonLinks[0]?.url) || s.title + ' manhwa';
    newLinks = buildFromSearch(searchTerm);
    console.log(`  ~ ${s.title}: no ASIN, search "${searchTerm}" → 6 links`);
  }

  updated++;
  return { ...s, buy_links: newLinks };
});

writeFileSync(DATA_PATH, JSON.stringify(migrated, null, 2) + '\n');
console.log(`\n✅ Rebuilt: ${updated} series | No buy_links: ${skipped}`);
