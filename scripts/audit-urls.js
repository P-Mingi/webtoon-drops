import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

const sleep = ms => new Promise(r => setTimeout(r, ms));

function normalize(str) {
  return (str || '')
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function titleMatch(expected, pageTitle) {
  const e = normalize(expected);
  const p = normalize(pageTitle);
  const words = e.split(' ').filter(w => w.length > 2);
  const matches = words.filter(w => p.includes(w));
  return matches.length >= Math.ceil(words.length * 0.6);
}

async function checkUrl(s) {
  // Use read_url (our schema uses read_url, not url)
  const url = s.read_url || s.platforms?.[0]?.read_url;
  if (!url || url.includes('anilist.co')) {
    return { status: 'NO_URL', series: s, note: url?.includes('anilist.co') ? 'AniList placeholder URL' : 'missing' };
  }

  try {
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (compatible; site-auditor/1.0)',
        'Accept-Language': 'en-US,en;q=0.9'
      },
      redirect: 'follow'
    });

    const finalUrl = res.url;
    const html = await res.text();

    const ogTitleMatch = html.match(/<meta property="og:title" content="([^"]+)"/);
    const titleTagMatch = html.match(/<title>([^<|]+)/);
    const pageTitle = (ogTitleMatch?.[1] || titleTagMatch?.[1] || '')
      .replace(/ - WEBTOON$/i, '')
      .replace(/ \| Tapas$/i, '')
      .replace(/ \| Tappytoon$/i, '')
      .replace(/ - Official Comic.*$/i, '')
      .trim();

    const urlChanged = finalUrl !== url && !finalUrl.startsWith(url);
    const matched = titleMatch(s.title, pageTitle);

    if (!matched) {
      return { status: 'WRONG_PAGE', series: s, pageTitle, finalUrl, urlChanged, checkedUrl: url };
    }
    if (urlChanged) {
      return { status: 'REDIRECTED_BUT_OK', series: s, pageTitle, finalUrl, checkedUrl: url };
    }
    return { status: 'OK', series: s, pageTitle, checkedUrl: url };

  } catch (e) {
    return { status: 'ERROR', series: s, error: e.message, checkedUrl: url };
  }
}

// Platform/URL domain validation
function validateUrlDomain(s) {
  const url = s.read_url;
  if (!url) return null;
  const platformDomains = {
    webtoon: 'webtoons.com',
    tapas: 'tapas.io',
    tappytoon: 'tappytoon.com',
    mangaplus: 'mangaplus.shueisha.co.jp'
  };
  const expected = platformDomains[s.platform];
  if (expected && !url.includes(expected)) {
    return `platform="${s.platform}" but URL="${url}" — domain mismatch`;
  }
  if (s.platform === 'webtoon' && !url.includes('title_no=')) {
    return `WEBTOON URL missing title_no — "${url}"`;
  }
  return null;
}

async function main() {
  console.log(`\n🔍 Auditing ${series.length} series URLs...\n`);

  // Quick domain validation first (no network calls)
  console.log('=== DOMAIN VALIDATION (instant) ===');
  let domainIssues = 0;
  for (const s of series) {
    const issue = validateUrlDomain(s);
    if (issue) {
      console.log(`  ❌ ${s.title}: ${issue}`);
      domainIssues++;
    }
  }
  if (domainIssues === 0) console.log('  ✅ All URLs pass domain validation');
  console.log('');

  const results = { OK: [], WRONG_PAGE: [], ERROR: [], NO_URL: [], REDIRECTED_BUT_OK: [] };

  for (let i = 0; i < series.length; i++) {
    const s = series[i];
    process.stdout.write(`[${i + 1}/${series.length}] ${s.title}... `);

    const result = await checkUrl(s);
    (results[result.status] = results[result.status] || []).push(result);

    if (result.status === 'OK') process.stdout.write('✅\n');
    else if (result.status === 'WRONG_PAGE') process.stdout.write(`❌ GOT: "${result.pageTitle}"\n`);
    else if (result.status === 'ERROR') process.stdout.write(`⚠️  ${result.error}\n`);
    else if (result.status === 'NO_URL') process.stdout.write(`⬜ ${result.note || 'no URL'}\n`);
    else process.stdout.write(`↪️  redirected but ok\n`);

    await sleep(600);
  }

  console.log('\n========== AUDIT REPORT ==========\n');
  console.log(`✅ OK:              ${(results.OK || []).length}`);
  console.log(`❌ WRONG PAGE:      ${(results.WRONG_PAGE || []).length}`);
  console.log(`⚠️  ERRORS:          ${(results.ERROR || []).length}`);
  console.log(`⬜ NO/BAD URL:      ${(results.NO_URL || []).length}`);
  console.log(`↪️  REDIRECTED OK:  ${(results.REDIRECTED_BUT_OK || []).length}`);

  if ((results.WRONG_PAGE || []).length > 0) {
    console.log('\n❌ WRONG PAGE — NEEDS IMMEDIATE FIX:');
    for (const r of results.WRONG_PAGE) {
      console.log(`\n  Series:    ${r.series.title}`);
      console.log(`  ID:        ${r.series.id}`);
      console.log(`  Platform:  ${r.series.platform}`);
      console.log(`  Our URL:   ${r.checkedUrl}`);
      console.log(`  Got page:  "${r.pageTitle}"`);
      if (r.finalUrl !== r.checkedUrl) console.log(`  Final URL: ${r.finalUrl}`);
    }
  }

  if ((results.ERROR || []).length > 0) {
    console.log('\n⚠️  ERRORS:');
    for (const r of results.ERROR) {
      console.log(`  • ${r.series.title} — ${r.checkedUrl} — ${r.error}`);
    }
  }

  if ((results.NO_URL || []).length > 0) {
    console.log('\n⬜ NO/BAD URL:');
    for (const r of results.NO_URL) {
      console.log(`  • ${r.series.title} (${r.series.platform}) — ${r.note}`);
    }
  }

  const report = {
    timestamp: new Date().toISOString(),
    summary: {
      ok: (results.OK || []).length,
      wrong: (results.WRONG_PAGE || []).length,
      error: (results.ERROR || []).length,
      noUrl: (results.NO_URL || []).length,
      redirectedOk: (results.REDIRECTED_BUT_OK || []).length,
    },
    wrongPages: (results.WRONG_PAGE || []).map(r => ({
      id: r.series.id, title: r.series.title, platform: r.series.platform,
      ourUrl: r.checkedUrl, gotPage: r.pageTitle, finalUrl: r.finalUrl
    })),
    errors: (results.ERROR || []).map(r => ({ id: r.series.id, title: r.series.title, url: r.checkedUrl, error: r.error })),
    noUrl: (results.NO_URL || []).map(r => ({ id: r.series.id, title: r.series.title, platform: r.series.platform, note: r.note }))
  };

  writeFileSync(join(__dirname, '../url-audit-report.json'), JSON.stringify(report, null, 2));
  console.log('\n📄 Report saved to url-audit-report.json');
}

main().catch(console.error);
