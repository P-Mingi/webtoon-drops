/**
 * Generate the last N episode release dates for a series,
 * working backwards from today using the series' update_day.
 * Inserts hiatus blocks where gaps > 31 days occurred.
 *
 * Returns array of items, each either:
 *   { type: 'episode', date: Date, episodeNumber: number|null }
 *   { type: 'hiatus',  start: string, end: string, reason: string }
 */
export function getEpisodeHistory(series, count = 20) {
  if (!series.update_day && series.update_day !== 0) return [];

  const KST_OFFSET_MS = 9 * 60 * 60 * 1000;
  const now = new Date();

  // Find the most recent past drop date (in UTC)
  function getMostRecentDropUTC(fromDate) {
    const fromKST = new Date(fromDate.getTime() + KST_OFFSET_MS);
    const currentDayKST = fromKST.getUTCDay();
    let daysBack = (currentDayKST - series.update_day + 7) % 7;
    if (daysBack === 0) daysBack = 7; // don't use today — use last week
    const lastDropKST = new Date(fromKST);
    lastDropKST.setUTCDate(lastDropKST.getUTCDate() - daysBack);
    lastDropKST.setUTCHours(series.release_hour_kst || 0, 0, 0, 0);
    return new Date(lastDropKST.getTime() - KST_OFFSET_MS);
  }

  const hiatusHistory = series.hiatus_history || [];
  const items = [];
  let cursor = new Date(now);
  let episodeOffset = 0; // how many episodes back from total_episodes

  // If currently on hiatus, start from hiatus start date
  const activeHiatus = hiatusHistory.find(h => h.end === null);
  if (activeHiatus) {
    const hiatusStart = new Date(activeHiatus.start + '-01');
    cursor = new Date(hiatusStart.getTime() - 7 * 24 * 60 * 60 * 1000); // week before hiatus
  }

  while (items.filter(i => i.type === 'episode').length < count) {
    const drop = getMostRecentDropUTC(cursor);

    // Check if this date falls inside a hiatus period
    const inHiatus = hiatusHistory.find(h => {
      const start = new Date(h.start + '-01');
      const end = h.end ? new Date(h.end + '-01') : new Date();
      return drop >= start && drop <= end;
    });

    if (inHiatus) {
      // Insert hiatus block if not already inserted
      const alreadyInserted = items.some(
        i => i.type === 'hiatus' && i.start === inHiatus.start
      );
      if (!alreadyInserted) {
        items.push({
          type: 'hiatus',
          start: inHiatus.start,
          end: inHiatus.end || 'present',
          reason: inHiatus.reason || 'Hiatus'
        });
      }
      // Skip back 7 days past the hiatus start
      const hiatusStart = new Date(inHiatus.start + '-01');
      cursor = new Date(hiatusStart.getTime() - 7 * 24 * 60 * 60 * 1000);
      continue;
    }

    // Calculate episode number if total_episodes is known
    let episodeNumber = null;
    if (series.total_episodes) {
      episodeNumber = series.total_episodes - episodeOffset;
      if (episodeNumber <= 0) break;
    }

    items.push({ type: 'episode', date: drop, episodeNumber });
    episodeOffset++;

    // Move cursor back 7 days
    cursor = new Date(drop.getTime() - 7 * 24 * 60 * 60 * 1000);

    // Safety: don't go back more than 10 years
    if (drop < new Date('2010-01-01')) break;
  }

  return items;
}

export function formatHistoryDate(date) {
  return date.toLocaleDateString('en-US', {
    weekday: 'short',
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC'
  });
}
