#!/usr/bin/env node
/**
 * enrich-tapas-links.js
 *
 * Adds Tapas read_url to EXISTING series that are on Tapas.
 * NEVER adds new series entries. Only enriches series already in the DB.
 *
 * Strategy:
 *  1. Fetch tapas sitemap-comic.xml → set of 44k slugs
 *  2. For each existing series without Tapas:
 *     a. Exact slug match (our id === tapas slug)  → high confidence
 *     b. Slug with small variations (hyphen/apostrophe) → medium confidence
 *  3. Verify all candidates by fetching /series/SLUG/info and comparing og:title
 *     to our stored title. Only add if title similarity >= 0.75.
 *  4. Save — never changes platform, never adds entries.
 *
 * Run: node scripts/enrich-tapas-links.js
 */

import { readFileSync, writeFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { execSync } from 'child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');

const sleep = ms => new Promise(r => setTimeout(r, ms));
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/122.0.0.0 Safari/537.36';

function fetchHtml(url) {
  return execSync(
    `curl -s -L --max-time 20 -H "User-Agent: ${UA}" -H "Accept-Language: en-US,en;q=0.9" "${url}"`,
    { maxBuffer: 20 * 1024 * 1024 }
  ).toString();
}

function normSlug(s) {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
}

// Title similarity: jaccard on word sets (words > 2 chars)
function titleSimilarity(a, b) {
  const words = s => new Set(s.toLowerCase().replace(/[^a-z0-9 ]/g, ' ').split(/\s+/).filter(w => w.length > 2));
  const wa = words(a);
  const wb = words(b);
  if (!wa.size || !wb.size) return 0;
  let intersection = 0;
  for (const w of wa) if (wb.has(w)) intersection++;
  return intersection / Math.max(wa.size, wb.size);
}

// Generate slug variations to check against Tapas
function slugVariations(slug) {
  const variants = new Set([slug]);
  // Remove leading "the-"
  if (slug.startsWith('the-')) variants.add(slug.slice(4));
  // Add "the-"
  if (!slug.startsWith('the-')) variants.add('the-' + slug);
  // Apostrophe-s: replace "-s-" with "-s-" → "s" (e.g. lead-s → leads)
  variants.add(slug.replace(/-s-/g, 's-').replace(/-s$/g, 's'));
  // Remove possessive marker artifact
  variants.add(slug.replace(/-s-/g, '-'));
  return [...variants];
}

function parseTapasTitle(html) {
  const m = html.match(/<meta property="og:title" content="([^"]+)"/);
  let title = m?.[1]?.trim() ?? '';
  title = title.replace(/^Read\s+/i, '').replace(/\s*\|\s*Tapas.*$/i, '').trim();
  // Decode HTML entities
  title = title.replace(/&amp;/g, '&').replace(/&rsquo;/g, "'").replace(/&ldquo;/g, '"').replace(/&rdquo;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCharCode(+n));
  return title;
}

async function main() {
  console.log('🔗 Tapas Enrich — adding Tapas URLs to existing series\n');

  // Step 1: Fetch sitemap
  console.log('📥 Fetching Tapas sitemap-comic.xml…');
  const sitemap = fetchHtml('https://tapas.io/sitemap-comic.xml');
  const tapasSlugSet = new Set(
    [...sitemap.matchAll(/<loc>https:\/\/tapas\.io\/series\/([^<]+)<\/loc>/g)]
      .map(m => normSlug(m[1]))
  );
  console.log(`   ${tapasSlugSet.size} Tapas slugs loaded\n`);

  // Step 2: Load existing data
  const data = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));
  console.log(`   ${data.length} series in DB\n`);

  // Step 3: Find candidates (existing series without Tapas, not on hiatus)
  const candidates = [];
  for (const s of data) {
    const hasTapas = s.platforms?.some(p => p.platform === 'tapas') || s.platform === 'tapas';
    if (hasTapas) continue;
    if (!s.title) continue;

    const baseSlug = normSlug(s.id);
    for (const variant of slugVariations(baseSlug)) {
      if (tapasSlugSet.has(variant)) {
        candidates.push({ series: s, tapasSlug: variant, needsVerify: variant !== baseSlug });
        break;
      }
    }
  }
  console.log(`   ${candidates.length} candidates to verify\n`);

  // Step 4: Verify + enrich
  const updated = data.map(s => ({ ...s }));
  let enriched = 0;
  let rejected = 0;

  for (let i = 0; i < candidates.length; i++) {
    const { series, tapasSlug, needsVerify } = candidates[i];
    await sleep(700);

    const url = `https://tapas.io/series/${tapasSlug}/info`;
    process.stdout.write(`[${i+1}/${candidates.length}] ${tapasSlug.slice(0,40).padEnd(41)} `);

    let tapasTitle = '';
    try {
      const html = fetchHtml(url);
      tapasTitle = parseTapasTitle(html);
      if (!tapasTitle) { console.log('✗ no title'); rejected++; continue; }

      // Always verify title similarity
      const sim = titleSimilarity(series.title, tapasTitle);
      if (sim < 0.75) {
        console.log(`✗ title mismatch (${(sim*100).toFixed(0)}%) "${tapasTitle}" ≠ "${series.title}"`);
        rejected++;
        continue;
      }
    } catch (e) {
      console.log(`✗ fetch error: ${e.message}`);
      rejected++;
      continue;
    }

    // Looks good — add Tapas to platforms
    const idx = updated.findIndex(s => s.id === series.id);
    const s = updated[idx];
    const currentPlatforms = s.platforms ?? [{ platform: s.platform, label: s.platform_label ?? s.platform.toUpperCase(), read_url: s.read_url }];
    updated[idx] = {
      ...s,
      platforms: [...currentPlatforms, { platform: 'tapas', label: 'TAPAS', read_url: url }],
    };

    console.log(`✅ "${tapasTitle}"`);
    enriched++;
  }

  // Step 5: Save
  writeFileSync(DATA_PATH, JSON.stringify(updated, null, 2));

  console.log('\n' + '═'.repeat(60));
  console.log('ENRICH COMPLETE');
  console.log('═'.repeat(60));
  console.log(`  Enriched (Tapas added):  ${enriched}`);
  console.log(`  Rejected (no match):     ${rejected}`);
  console.log(`  Total series unchanged:  ${updated.length}`);
}

main().catch(console.error);
