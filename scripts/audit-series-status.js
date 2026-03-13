import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const DATA_PATH = join(__dirname, '../src/data/series-data.json');
const series = JSON.parse(readFileSync(DATA_PATH, 'utf-8'));

console.log('\n=== SERIES STATUS AUDIT ===\n');

const active = [];
const onHiatus = [];
const noUpdateDay = [];

for (const s of series) {
  if (s.on_hiatus) {
    onHiatus.push(s);
  } else if (s.update_day === null || s.update_day === undefined) {
    noUpdateDay.push(s);
  } else {
    active.push(s);
  }
}

console.log(`✅ ACTIVE (${active.length} series):`);
active.forEach(s => {
  const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
  console.log(`  • ${s.title.padEnd(45)} ${(s.platform_label || s.platform).padEnd(12)} ${days[s.update_day] || '?'}`);
});

console.log(`\n⏸️  ON HIATUS (${onHiatus.length} series):`);
onHiatus.forEach(s => {
  const reason = s.hiatus_history?.[0]?.reason ?? '(no reason recorded)';
  console.log(`  • ${s.title.padEnd(45)} ${(s.platform_label || s.platform).padEnd(12)} — ${reason.slice(0, 60)}`);
});

console.log(`\n❓ NO UPDATE DAY — needs manual verification (${noUpdateDay.length} series):`);
noUpdateDay.forEach(s => {
  console.log(`  • ${s.title.padEnd(45)} ${(s.platform_label || s.platform).padEnd(12)} — ${s.read_url}`);
});

console.log('\n=== SUMMARY ===');
console.log(`  Total series : ${series.length}`);
console.log(`  Active       : ${active.length}`);
console.log(`  On hiatus    : ${onHiatus.length}`);
console.log(`  No update day: ${noUpdateDay.length}`);
