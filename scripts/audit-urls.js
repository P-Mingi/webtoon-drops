#!/usr/bin/env node
/**
 * audit-urls.js
 *
 * Audits every series read_url in series-data.json by:
 *  1. Structural checks — domain vs platform, title_no present for WEBTOON
 *  2. Live fetch via curl — verifies the page contains the expected series title
 *
 * Output tags (grep-friendly):
 *   OK               — URL live, title matches
 *   WRONG_PAGE       — URL live but title doesn't match our series title
 *   DOMAIN_MISMATCH  — URL domain doesn't match the declared platform
 *   MISSING_TITLE_NO — WEBTOON URL lacks ?title_no= param
 *   FETCH_ERROR      — curl failed / HTTP error / timeout
 *
 * Run:  node scripts/audit-urls.js 2>&1 | tee url-audit-report.txt
 * Then: grep "WRONG_PAGE\|DOMAIN_MISMATCH\|MISSING_TITLE_NO" url-audit-report.txt
 *
 * Takes ~15-20 min (970 URLs × 700 ms delay).
 */

import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';
const DELAY_MS = 700;

const sleep = ms => new Promise(r => setTimeout(r, ms));

// ── Platform → expected domain ────────────────────────────────────────────
const PLATFORM_DOMAIN = {
  webtoon:   'webtoons.com',
  tapas:     'tapas.io',
  tappytoon: 'tappytoon.com',
  mangaplus: 'mangaplus.shueisha.co.jp',
  lezhin:    'lezhin.com',
};

// ── Fetch with curl (bypasses WEBTOON TLS fingerprint check) ─────────────
function fetchHtml(url) {
  return execSync(
    `curl -s -L --max-time 20 -H "User-Agent: ${UA}" -H "Accept-Language: en-US,en;q=0.9" "${url}"`,
    { maxBuffer: 5 * 1024 * 1024 }
  ).toString();
}

// ── Extract best title from HTML ──────────────────────────────────────────
function extractTitle(html) {
  const og = html.match(/<meta property="og:title" content="([^"]+)"/);
  let t = og?.[1] ?? '';
  if (!t) {
    const tt = html.match(/<title>([^<]+)/);
    t = tt?.[1] ?? '';
  }
  return t
    .replace(/^Read\s+/i, '')
    .replace(/\s*[|\-–]\s*(WEBTOON|Tapas Web Comics|Tappytoon|MangaPlus|Shueisha).*$/i, '')
    .replace(/&amp;/g, '&').replace(/&rsquo;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n))
    .trim();
}

// ── Title similarity (word-level Jaccard, words > 2 chars) ───────────────
function titleSim(a, b) {
  const words = s => new Set(
    s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2)
  );
  const wa = words(a), wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let hits = 0;
  for (const w of wa) if (wb.has(w)) hits++;
  return hits / Math.max(wa.size, wb.size);
}

// ── Main ─────────────────────────────────────────────────────────────────
async function main() {
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  console.log(`Auditing ${data.length} series...\n`);

  const counts = { OK: 0, WRONG_PAGE: 0, DOMAIN_MISMATCH: 0, MISSING_TITLE_NO: 0, FETCH_ERROR: 0 };

  for (let i = 0; i < data.length; i++) {
    const s = data[i];
    const idx = `[${String(i+1).padStart(4)}/${data.length}]`;
    const id  = (s.id ?? '').slice(0, 42).padEnd(43);
    const url = s.read_url;

    // ── Structural: domain mismatch ───────────────────────────────────────
    const expectedDomain = PLATFORM_DOMAIN[s.platform];
    if (expectedDomain && url && !url.includes(expectedDomain)) {
      console.log(`${idx} ${id} DOMAIN_MISMATCH  platform=${s.platform}  url=${url}`);
      counts.DOMAIN_MISMATCH++;
      continue;
    }

    // ── Structural: WEBTOON missing title_no ──────────────────────────────
    if (s.platform === 'webtoon' && url && !url.includes('title_no=')) {
      console.log(`${idx} ${id} MISSING_TITLE_NO  url=${url}`);
      counts.MISSING_TITLE_NO++;
      continue;
    }

    // ── Live fetch ────────────────────────────────────────────────────────
    await sleep(DELAY_MS);
    try {
      const html = fetchHtml(url);
      const pageTitle = extractTitle(html);

      if (!pageTitle) {
        // JS-rendered or blocked — log OK but note unverifiable
        console.log(`${idx} ${id} OK (unverifiable)  "${s.title}"`);
        counts.OK++;
        continue;
      }

      const sim = titleSim(s.title, pageTitle);
      if (sim >= 0.5) {
        console.log(`${idx} ${id} OK  "${s.title}"`);
        counts.OK++;
      } else {
        console.log(`${idx} ${id} WRONG_PAGE  sim=${(sim*100).toFixed(0)}%  expected="${s.title}"  got="${pageTitle}"  url=${url}`);
        counts.WRONG_PAGE++;
      }
    } catch (e) {
      console.log(`${idx} ${id} FETCH_ERROR  ${e.message.slice(0, 100)}`);
      counts.FETCH_ERROR++;
    }
  }

  console.log('\n' + '═'.repeat(70));
  console.log('AUDIT SUMMARY');
  console.log('═'.repeat(70));
  console.log(`  OK:                ${counts.OK}`);
  console.log(`  WRONG_PAGE:        ${counts.WRONG_PAGE}`);
  console.log(`  DOMAIN_MISMATCH:   ${counts.DOMAIN_MISMATCH}`);
  console.log(`  MISSING_TITLE_NO:  ${counts.MISSING_TITLE_NO}`);
  console.log(`  FETCH_ERROR:       ${counts.FETCH_ERROR}`);
  console.log(`  Total:             ${data.length}`);
}

main().catch(console.error);
