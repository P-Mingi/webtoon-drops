/**
 * Geo-detection via browser timezone.
 * No API, no cookie, no network request, instant.
 * Returns ISO country code for Amazon store selection.
 */
export function detectCountry() {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (!tz) return 'default';

    // France + French-speaking Belgium/Switzerland
    if (['Europe/Paris', 'Europe/Brussels', 'Europe/Luxembourg'].includes(tz)) return 'FR';

    // French-speaking Africa (amazon.fr is closest)
    if (['Africa/Tunis', 'Africa/Algiers', 'Africa/Casablanca',
         'Africa/Abidjan', 'Africa/Dakar'].includes(tz)) return 'FR';

    // UK + Ireland
    if (['Europe/London', 'Europe/Dublin'].includes(tz)) return 'GB';

    // Germany + Austria + German-speaking Switzerland
    if (['Europe/Berlin', 'Europe/Vienna', 'Europe/Zurich'].includes(tz)) return 'DE';

    // Spain
    if (['Europe/Madrid'].includes(tz)) return 'ES';

    // Italy
    if (['Europe/Rome'].includes(tz)) return 'IT';

    // Canada → Amazon.com (no amazon.ca program yet)
    if (tz.startsWith('America/Toronto') || tz.startsWith('America/Vancouver') ||
        tz.startsWith('America/Winnipeg') || tz.startsWith('America/Halifax') ||
        tz.startsWith('America/St_Johns')) return 'CA';

    // Australia → Amazon.com (amazon.com.au affiliate separate — skip for now)
    if (tz.startsWith('Australia/')) return 'AU';

    // US — all American timezones not already matched
    if (tz.startsWith('America/')) return 'US';

    // Asia, rest of world → US (English Amazon)
    return 'default';

  } catch {
    return 'default';
  }
}

/**
 * Return the single best buy link for the user's country.
 * Falls back to 'default' link, then first link.
 */
export function getBestLink(buyLinks, country) {
  if (!buyLinks || buyLinks.length === 0) return null;

  const exact = buyLinks.find(l => l.countries?.includes(country));
  if (exact) return exact;

  const fallback = buyLinks.find(l => l.countries?.includes('default'));
  if (fallback) return fallback;

  return buyLinks[0];
}

/**
 * Sort buy_links so the most relevant retailer for the user's country is first.
 * exact match → default → others
 */
export function sortBuyLinks(buyLinks, country) {
  if (!buyLinks || buyLinks.length === 0) return [];

  return [...buyLinks].sort((a, b) => {
    const rank = l =>
      l.countries?.includes(country) ? 0 :
      l.countries?.includes('default') ? 1 : 2;
    return rank(a) - rank(b);
  });
}
