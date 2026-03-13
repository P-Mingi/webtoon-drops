import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const dataPath = path.resolve(__dirname, '../src/data/series-data.json');
let data = JSON.parse(fs.readFileSync(dataPath, 'utf8'));

// 1. Update Villains Are Destined to Die — add Tappytoon as second platform
const villainsIdx = data.findIndex(s => s.id === 'villains-are-destined-to-die');
if (villainsIdx !== -1) {
  data[villainsIdx] = {
    ...data[villainsIdx],
    platforms: [
      { platform: 'tapas',     label: 'TAPAS',     read_url: 'https://tapas.io/series/villains-are-destined-to-die/info' },
      { platform: 'tappytoon', label: 'TAPPYTOON', read_url: 'https://www.tappytoon.com/en/comics/villains-are-destined-to-die' },
    ],
  };
  console.log('Updated: Villains Are Destined to Die (+Tappytoon)');
} else {
  console.warn('WARNING: villains-are-destined-to-die not found');
}

// 2. Add Skeleton Soldier (new entry) — only if not already present
const skeletonExists = data.some(s => s.id === 'the-skeleton-soldier-failed-to-defend-the-dungeon');
if (!skeletonExists) {
  data.push({
    id: 'the-skeleton-soldier-failed-to-defend-the-dungeon',
    title: 'The Skeleton Soldier Failed to Defend the Dungeon',
    title_kr: '해골 병사는 던전을 지키지 못했다',
    anilist_id: 103156,
    platform: 'tappytoon',
    platform_label: 'TAPPYTOON',
    read_url: 'https://www.tappytoon.com/en/comics/skeleton-soldier',
    platforms: [
      { platform: 'tappytoon', label: 'TAPPYTOON', read_url: 'https://www.tappytoon.com/en/comics/skeleton-soldier' },
    ],
    update_day: null,
    update_day_name: null,
    release_hour_kst: 0,
    on_hiatus: false,
    genre: 'Fantasy',
    tags: ['fantasy', 'action', 'regression'],
    amazon_vol1: null,
    seo_description: 'The Skeleton Soldier Failed to Defend the Dungeon releases on Tappytoon. Live countdown.',
  });
  console.log('Added: The Skeleton Soldier Failed to Defend the Dungeon');
} else {
  console.log('Skipped: skeleton-soldier already exists');
}

fs.writeFileSync(dataPath, JSON.stringify(data, null, 2));
console.log(`Done. Total series: ${data.length}`);
