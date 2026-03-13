#!/usr/bin/env node
/**
 * audit-amazon-links.js
 *
 * Checks every Amazon buy_link in series-data.json by fetching the
 * amazon.com page and verifying the ASIN resolves to a real product.
 *
 * Output tags (grep-friendly):
 *   OK           — page returned a valid product title
 *   DEAD         — 404 / redirect to homepage / no product title found
 *   B0_ASIN      — B0-prefix ASIN (may fail on EU stores — flag for review)
 *   FETCH_ERROR  — curl failed / timeout
 *
 * Run:  node scripts/audit-amazon-links.js 2>&1 | tee amazon-audit-report.txt
 * Then: grep "DEAD\|B0_ASIN\|FETCH_ERROR" amazon-audit-report.txt
 *
 * Takes ~2-5 min (checks amazon_us links only, ~300 series × 1s delay).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DELAY_MS = 1000;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Fetch with curl ───────────────────────────────────────────────────────────
function fetchHtml(url) {
  return execSync(
    `curl -s -L --max-time 15 -H "User-Agent: ${UA}" -H "Accept-Language: en-US,en;q=0.9" "${url}"`,
    { maxBuffer: 5 * 1024 * 1024 }
  ).toString();
}

// ── Extract product title from Amazon HTML ────────────────────────────────────
function extractProductTitle(html) {
  // Amazon product pages have #productTitle or og:title
  const og = html.match(/<meta property="og:title" content="([^"]+)"/);
  if (og?.[1] && !og[1].toLowerCase().includes('amazon')) return og[1].trim();

  const pt = html.match(/id="productTitle"[^>]*>([^<]+)/);
  if (pt?.[1]) return pt[1].trim();

  const tt = html.match(/<title>([^<]+)/);
  const t = tt?.[1]?.trim() ?? '';
  // If redirected to homepage, title will just be "Amazon.com" or similar
  if (!t || t.toLowerCase().match(/^amazon[\s.]/)) return '';
  return t;
}

// ── Detect B0-prefix ASIN ─────────────────────────────────────────────────────
function isB0Asin(url) {
  const m = url.match(/\/dp\/([A-Z0-9]{10})/);
  return m ? m[1].startsWith('B0') : false;
}

// ── Extract ASIN from URL ─────────────────────────────────────────────────────
function extractAsin(url) {
  const m = url.match(/\/dp\/([A-Z0-9]{10})/);
  return m?.[1] ?? '??????????';
}

// ── Main ─────────────────────────────────────────────────────────────────────
async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

  // Collect all series that have buy_links with a /dp/ URL
  const toCheck = [];
  for (const s of data) {
    const links = s.buy_links ?? [];
    // Only check amazon_us (canonical — if this works, ISBN-based ASINs work everywhere)
    const usLink = links.find(l => l.retailer === 'amazon_us' && l.url.includes('/dp/'));
    if (usLink) toCheck.push({ series: s, link: usLink });
  }

  console.log(`Auditing ${toCheck.length} Amazon US buy links...\n`);

  const counts = { OK: 0, DEAD: 0, B0_ASIN: 0, FETCH_ERROR: 0 };

  for (let i = 0; i < toCheck.length; i++) {
    const { series: s, link } = toCheck[i];
    const idx  = `[${String(i + 1).padStart(3)}/${toCheck.length}]`;
    const id   = (s.id ?? '').slice(0, 42).padEnd(43);
    const asin = extractAsin(link.url);
    const b0   = isB0Asin(link.url);

    await sleep(DELAY_MS);

    try {
      const html = fetchHtml(link.url);
      const title = extractProductTitle(html);

      if (!title) {
        const tag = b0 ? 'B0_ASIN+DEAD' : 'DEAD';
        console.log(`${idx} ${id} ${tag.padEnd(12)}  ASIN=${asin}  url=${link.url}`);
        counts.DEAD++;
        if (b0) counts.B0_ASIN++;
      } else if (b0) {
        console.log(`${idx} ${id} B0_ASIN      ASIN=${asin}  title="${title.slice(0, 60)}"`);
        counts.B0_ASIN++;
      } else {
        console.log(`${idx} ${id} OK           ASIN=${asin}  title="${title.slice(0, 60)}"`);
        counts.OK++;
      }
    } catch (e) {
      console.log(`${idx} ${id} FETCH_ERROR  ${e.message.slice(0, 80)}`);
      counts.FETCH_ERROR++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('AMAZON AUDIT SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  OK:           ${counts.OK}`);
  console.log(`  DEAD:         ${counts.DEAD}`);
  console.log(`  B0_ASIN:      ${counts.B0_ASIN}  (includes dead B0s above)`);
  console.log(`  FETCH_ERROR:  ${counts.FETCH_ERROR}`);
  console.log(`  Total:        ${toCheck.length}`);
  console.log('\nFix dead links: replace /dp/ASIN with a valid ISBN-10 based ASIN');
  console.log('B0 ASINs may work on amazon.com but fail on EU stores — verify per series.');
}

main().catch(console.error);
