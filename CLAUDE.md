# WebtoonDrops — Claude Code Instructions

## PROJECT OVERVIEW
Astro 6 static site with `@astrojs/vercel` adapter (`output: 'hybrid'`).
Deployed on Vercel. Source: `webtoon-drops/` directory.

## KEY FILES
- `src/data/series-data.json` — all series data (source of truth)
- `src/pages/[slug].astro` — individual series pages
- `src/pages/index.astro` — homepage with filter/sort
- `src/components/SeriesCard.astro` — card component
- `src/scripts/countdown.js` — client-side countdown logic (KST UTC+9)
- `src/scripts/geo.js` — client-side geo detection from browser timezone
- `scripts/fetch-covers.js` — bulk fetch AniList covers + scores
- `scripts/auto-update.js` — weekly hiatus/status sync from AniList
- `scripts/auto-discover.js` — AniList discovery for new series candidates

## SERIES DATA SCHEMA
```json
{
  "id": "slug-format",
  "title": "English Title",
  "title_kr": "Korean/Original Title",
  "anilist_id": 12345,
  "platform": "webtoon",
  "platform_label": "WEBTOON",
  "read_url": "https://...",
  "update_day": 1,
  "update_day_name": "Monday",
  "release_hour_kst": 0,
  "on_hiatus": false,
  "genre": "Action",
  "tags": ["action", "fantasy"],
  "seo_description": "...",
  "platforms": [{ "platform": "webtoon", "label": "WEBTOON", "read_url": "https://..." }],
  "total_episodes": null,
  "hiatus_history": [],
  "cover_url": "https://...",
  "anilist_score": 85,
  "buy_links": [
    {
      "retailer": "amazon_us",
      "label": "Amazon US",
      "url": "https://www.amazon.com/dp/ASIN?tag=webtoondrops-20",
      "countries": ["US", "CA", "AU", "default"]
    }
  ]
}
```

## AFFILIATE LINKS
- Schema field is `buy_links` array (NOT `amazon_vol1` — that field is deprecated and removed)
- Each link: `{ retailer, label, url, countries[] }`
- Supported retailers: `amazon_us`, `amazon_fr`, `amazon_uk`, `amazon_de`, `fnac`, `cultura`, `decitre`, `bdfugue`
- `countries` array determines geo-priority: `['FR','BE']` means shown first for French users
- Always include `rel="noopener sponsored"` on affiliate links
- Amazon.com tag: `webtoondrops-20` (replace with real tag when live)
- Amazon.fr tag: `YOUR-FR-TAG` (replace after signing up at associates.amazon.fr)
- Amazon.co.uk tag: `YOUR-UK-TAG` (replace after signing up at affiliate-program.amazon.co.uk)
- Fnac requires Awin account: awin.com → apply to "Fnac FR" program
- Decitre requires Affilae or TimeOne account
- `buy_links` is optional — series without it show no buy section

## DATE/TIME RULES
- All schedules are KST (UTC+9)
- Never use `Date.getDay()` — always use UTC offset: `new Date().getTime() + 9*60*60*1000`
- `update_day` is 0=Sunday, 1=Monday … 6=Saturday (JavaScript convention)

## ANILIST IDs
- `anilist_id: null` for Western WEBTOON originals (Let's Play, I Love Yoo, unOrdinary, Lore Olympus, SubZero, The Beginning After the End)
- `anilist_id: null` for series not yet in AniList
- Run `node scripts/fetch-covers.js` after adding/fixing anilist_ids
- Run `node scripts/auto-update.js` to check for hiatus/status changes

## BUILD
```bash
npm run build    # in webtoon-drops/ directory
npm run dev      # local dev server
```

## ADDING NEW SERIES
1. Add entry to `src/data/series-data.json`
2. Find correct AniList ID (type: MANGA, countryOfOrigin: KR)
3. Run `node scripts/fetch-covers.js` to get cover + score
4. Run `npm run build` to verify
