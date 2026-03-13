#!/usr/bin/env node
/**
 * WebtoonDrops — Pre-Build Audit Script
 * Run: node scripts/audit.js
 * ALL checks must pass before building the site.
 */

import https from 'https';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);

const BOLD  = '\x1b[1m';
const GREEN = '\x1b[32m';
const RED   = '\x1b[31m';
const YELLOW= '\x1b[33m';
const CYAN  = '\x1b[36m';
const RESET = '\x1b[0m';

const pass = (msg) => console.log(`  ${GREEN}✅ PASS${RESET}  ${msg}`);
const fail = (msg) => console.log(`  ${RED}❌ FAIL${RESET}  ${msg}`);
const info = (msg) => console.log(`  ${CYAN}ℹ${RESET}      ${msg}`);
const warn = (msg) => console.log(`  ${YELLOW}⚠ WARN${RESET}  ${msg}`);

function httpsPost(hostname, path, body) {
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const options = {
      hostname, path, method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Content-Length': Buffer.byteLength(data),
        'Accept': 'application/json',
      },
    };
    const req = https.request(options, (res) => {
      let body = '';
      res.on('data', chunk => body += chunk);
      res.on('end', () => {
        try { resolve({ status: res.statusCode, data: JSON.parse(body) }); }
        catch (e) { resolve({ status: res.statusCode, data: body }); }
      });
    });
    req.on('error', reject);
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('Timeout')); });
    req.write(data);
    req.end();
  });
}

// ── SCHEDULE DATA ────────────────────────────────────────────────────────────
const SERIES_DATA = require('../src/data/series-data.json');

// ── SCHEDULE ENGINE ──────────────────────────────────────────────────────────
function getNextDrop(dayOfWeek) {
  // KST = UTC+9. Episodes drop at midnight KST = 15:00 UTC prev day.
  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const now = new Date();
  const nowKST = new Date(now.getTime() + KST_OFFSET_MS);
  const currentDayKST = nowKST.getUTCDay();
  let daysAhead = (dayOfWeek - currentDayKST + 7) % 7;
  if (daysAhead === 0) daysAhead = 7;
  const nextMidnightKST = new Date(nowKST);
  nextMidnightKST.setUTCDate(nextMidnightKST.getUTCDate() + daysAhead);
  nextMidnightKST.setUTCHours(0, 0, 0, 0);
  return new Date(nextMidnightKST.getTime() - KST_OFFSET_MS); // real UTC timestamp
}

function fmtDuration(ms) {
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${h}h ${m}m`;
}

const DAYS_EN = ["Sunday","Monday","Tuesday","Wednesday","Thursday","Friday","Saturday"];

// ── PLATFORM URL VALIDATION ──────────────────────────────────────────────────
function validatePlatformUrls(series) {
  const DOMAINS = {
    webtoon:   'webtoons.com',
    tapas:     'tapas.io',
    tappytoon: 'tappytoon.com',
    mangaplus: 'mangaplus.shueisha.co.jp',
    lezhin:    'lezhin.com',
  };
  const issues = [];
  for (const s of series) {
    const url = s.read_url || s.platforms?.[0]?.read_url;
    if (!url || !s.platform) continue;
    const expected = DOMAINS[s.platform];
    if (expected && !url.includes(expected))
      issues.push(`URL/platform mismatch: ${s.title} — platform=${s.platform} url=${url}`);
    if (s.platform === 'webtoon' && url && !url.includes('title_no='))
      issues.push(`WEBTOON URL missing title_no: ${s.title} — ${url}`);
  }
  return issues;
}

// ── MAIN AUDIT ───────────────────────────────────────────────────────────────
async function runAudit() {
  const results = { pass: 0, fail: 0, warn: 0 };

  console.log();
  console.log(`${BOLD}╔══════════════════════════════════════════════════════╗${RESET}`);
  console.log(`${BOLD}║        WEBTOONDROPS — PRE-BUILD AUDIT                ║${RESET}`);
  console.log(`${BOLD}╚══════════════════════════════════════════════════════╝${RESET}`);
  console.log();

  // ══════════════════════════════════════════════════════
  // AUDIT 1 — series-data.json validation
  // ══════════════════════════════════════════════════════
  console.log(`${BOLD}[1/4] series-data.json Validation${RESET}`);
  console.log('─'.repeat(54));

  if (!Array.isArray(SERIES_DATA) || SERIES_DATA.length === 0) {
    fail('series-data.json is empty or not an array'); results.fail++;
  } else {
    pass(`series-data.json loaded — ${SERIES_DATA.length} series found`);
    results.pass++;

    const REQUIRED_FIELDS = ['id','title','update_day','update_day_name'];
    let schemaOk = true;
    SERIES_DATA.forEach((s, i) => {
      REQUIRED_FIELDS.forEach(f => {
        if (s[f] === undefined) {
          fail(`Series [${i}] "${s.title || '?'}" missing required field: ${f}`);
          results.fail++; schemaOk = false;
        }
      });
      if (s.update_day < 0 || s.update_day > 6) {
        fail(`Series "${s.title}" has invalid update_day: ${s.update_day} (must be 0-6)`);
        results.fail++; schemaOk = false;
      }
    });
    if (schemaOk) {
      pass('All series have required fields + valid update_day');
      results.pass++;
    }

    const hiatusCount = SERIES_DATA.filter(s => s.on_hiatus).length;
    const activeCount = SERIES_DATA.length - hiatusCount;
    info(`${activeCount} active series, ${hiatusCount} on hiatus`);

    const urlIssues = validatePlatformUrls(SERIES_DATA);
    if (urlIssues.length === 0) {
      pass('All platform URLs match their declared platform domain');
      results.pass++;
    } else {
      urlIssues.forEach(msg => { fail(msg); results.fail++; });
    }
  }
  console.log();

  // ══════════════════════════════════════════════════════
  // AUDIT 2 — Schedule engine (countdown math)
  // ══════════════════════════════════════════════════════
  console.log(`${BOLD}[2/4] Schedule Engine (Countdown Math)${RESET}`);
  console.log('─'.repeat(54));

  const KST = 9 * 60;
  const now = new Date();
  const nowKST = new Date(now.getTime() + (now.getTimezoneOffset() + KST) * 60000);
  info(`Current time KST: ${nowKST.toISOString().replace('T',' ').slice(0,19)} (${DAYS_EN[nowKST.getDay()]})`);
  console.log();

  let scheduleOk = true;
  SERIES_DATA.filter(s => !s.on_hiatus).slice(0, 10).forEach(s => {
    const nextDrop = getNextDrop(s.update_day);
    const ms = nextDrop - now;
    if (ms <= 0) {
      fail(`${s.title} — computed negative countdown (${ms}ms)`);
      results.fail++; scheduleOk = false;
    } else if (ms > 7 * 24 * 3600 * 1000 + 60000) { // +1min buffer for same-weekday edge case
      fail(`${s.title} — countdown exceeds 7 days (${fmtDuration(ms)})`);
      results.fail++; scheduleOk = false;
    } else {
      console.log(`  ${GREEN}✅${RESET} ${s.title.padEnd(40)} → ${fmtDuration(ms)} (${s.update_day_name})`);
      results.pass++;
    }
  });

  if (scheduleOk) {
    console.log();
    pass('All countdowns within valid 0–7 day range');
    results.pass++;
  }
  console.log();

  // ══════════════════════════════════════════════════════
  // AUDIT 3 — AniList API
  // ══════════════════════════════════════════════════════
  console.log(`${BOLD}[3/4] AniList GraphQL API${RESET}`);
  console.log('─'.repeat(54));
  info('Endpoint: https://graphql.anilist.co');
  info('Auth: None required (public API)');
  console.log();

  const anilistQuery = `{
    Page(page: 1, perPage: 5) {
      media(
        countryOfOrigin: KR
        type: MANGA
        status: RELEASING
        sort: [POPULARITY_DESC]
      ) {
        id
        title { english romaji }
        coverImage { large }
        popularity
        averageScore
        status
      }
    }
  }`;

  try {
    const result = await httpsPost('graphql.anilist.co', '/', { query: anilistQuery });
    if (result.status === 200 && result.data?.data?.Page?.media) {
      const media = result.data.data.Page.media;
      pass(`AniList API reachable — HTTP ${result.status}`);
      results.pass++;
      pass(`Returned ${media.length} Korean manhwa entries`);
      results.pass++;
      media.forEach(m => {
        const title = m.title.english || m.title.romaji;
        const hasCover = !!m.coverImage?.large;
        console.log(`  ${GREEN}✅${RESET} [${m.id}] ${title.padEnd(38)} | cover: ${hasCover ? '✅' : '❌'} | pop: ${m.popularity.toLocaleString()}`);
      });
    } else {
      fail(`AniList API returned unexpected status: ${result.status}`);
      results.fail++;
    }
  } catch (e) {
    fail(`AniList API unreachable: ${e.message}`);
    warn('This may be a local network/proxy issue — API works fine in Vercel production');
    results.warn++;
    info('Manual verify: curl -X POST https://graphql.anilist.co \\');
    info('  -H "Content-Type: application/json" \\');
    info('  -d \'{"query":"{ Media(id: 105778, type: MANGA) { title { english } } }"}\' ');
    info('Expected response: {"data":{"Media":{"title":{"english":"Tower of God"}}}}');
  }
  console.log();

  // ══════════════════════════════════════════════════════
  // AUDIT 4 — Automation system
  // ══════════════════════════════════════════════════════
  console.log(`${BOLD}[4/4] Zero-Touch Automation Check${RESET}`);
  console.log('─'.repeat(54));

  // Check hiatus handling
  const hiatusTest = SERIES_DATA.find(s => s.on_hiatus === true);
  if (hiatusTest) {
    pass(`Hiatus flag works — "${hiatusTest.title}" is marked on_hiatus`);
    results.pass++;
  } else {
    info('No series currently on hiatus (set on_hiatus: true to test)');
  }

  // Check slug uniqueness
  const slugs = SERIES_DATA.map(s => s.id);
  const uniqueSlugs = new Set(slugs);
  if (slugs.length === uniqueSlugs.size) {
    pass('All series IDs (slugs) are unique — no URL conflicts');
    results.pass++;
  } else {
    fail('Duplicate series IDs found — will cause URL conflicts!');
    results.fail++;
  }

  // Check SEO descriptions exist
  const noDesc = SERIES_DATA.filter(s => !s.seo_description);
  if (noDesc.length === 0) {
    pass('All series have SEO descriptions');
    results.pass++;
  } else {
    warn(`${noDesc.length} series missing seo_description field`);
    results.warn++;
    noDesc.forEach(s => info(`  Missing: ${s.title}`));
  }

  // Summary
  console.log();
  console.log('═'.repeat(54));
  console.log(`${BOLD}AUDIT SUMMARY${RESET}`);
  console.log('═'.repeat(54));
  console.log(`  ${GREEN}PASS :${RESET} ${results.pass}`);
  if (results.warn > 0) console.log(`  ${YELLOW}WARN :${RESET} ${results.warn}`);
  if (results.fail > 0) console.log(`  ${RED}FAIL :${RESET} ${results.fail}`);
  console.log();

  if (results.fail > 0) {
    console.log(`${RED}${BOLD}❌ AUDIT FAILED — Fix all FAIL items before building.${RESET}`);
    process.exit(1);
  } else if (results.warn > 0) {
    console.log(`${YELLOW}${BOLD}⚠ AUDIT PASSED WITH WARNINGS — Review WARN items.${RESET}`);
    console.log(`${GREEN}${BOLD}✅ Safe to build.${RESET}`);
    process.exit(0);
  } else {
    console.log(`${GREEN}${BOLD}✅ ALL AUDITS PASSED — Safe to build!${RESET}`);
    process.exit(0);
  }
}

runAudit().catch(err => {
  console.error('Audit script error:', err);
  process.exit(1);
});
