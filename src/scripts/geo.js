/**
 * Detect user's approximate country from browser timezone.
 * No API call, no cookie, no GDPR concern.
 * Returns ISO 3166-1 alpha-2 country code.
 */
export function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;

    if (!tz) return 'default';

    // France + French-speaking
    if (['Europe/Paris', 'Europe/Brussels', 'Europe/Luxembourg',
         'Africa/Tunis', 'Africa/Algiers', 'Africa/Casablanca'].includes(tz)) return 'FR';

    // UK / Ireland
    if (['Europe/London', 'Europe/Dublin'].includes(tz)) return 'GB';

    // Germany / Austria / Switzerland (German)
    if (['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich'].includes(tz)) return 'DE';

    // Canada
    if (tz.startsWith('America/Toronto') || tz.startsWith('America/Vancouver') ||
        tz.startsWith('America/Montreal')) return 'CA';

    // Australia
    if (tz.startsWith('Australia/')) return 'AU';

    // Korea
    if (tz === 'Asia/Seoul') return 'KR';

    // US (most American timezones)
    if (tz.startsWith('America/')) return 'US';

    // Everything else — default to US (English Amazon)
    return 'default';
  } catch {
    return 'default';
  }
}

/**
 * Given a buy_links array, return them sorted so the
 * most relevant retailer for the user's country is first.
 */
export function sortBuyLinks(buyLinks, country) {
  if (!buyLinks || buyLinks.length === 0) return [];

  return [...buyLinks].sort((a, b) => {
    const aRelevant = a.countries?.includes(country) ? 0 : 1;
    const bRelevant = b.countries?.includes(country) ? 0 : 1;
    return aRelevant - bRelevant;
  });
}
