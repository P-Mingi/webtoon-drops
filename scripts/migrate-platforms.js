import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const data = JSON.parse(fs.readFileSync(path.resolve(__dirname, '../src/data/series-data.json'), 'utf8'));

const migrated = data.map(series => {
  if (series.platforms) return series; // already migrated
  return {
    ...series,
    platforms: [{
      platform: series.platform,
      label: series.platform_label,
      read_url: series.read_url
    }]
  };
});

const outPath = path.resolve(__dirname, '../src/data/series-data.json');
fs.writeFileSync(outPath, JSON.stringify(migrated, null, 2));
console.log(`Migrated ${migrated.length} series`);
