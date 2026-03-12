export async function fetchManhwaCovers(anilistIds) {
  const query = `
    query ($ids: [Int]) {
      Page(page: 1, perPage: 50) {
        media(id_in: $ids, type: MANGA) {
          id
          title { english romaji }
          coverImage { large extraLarge }
          description(asHtml: false)
          averageScore
          popularity
          genres
        }
      }
    }
  `;
  try {
    const res = await fetch('https://graphql.anilist.co', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ query, variables: { ids: anilistIds } })
    });
    const data = await res.json();
    return data.data.Page.media;
  } catch {
    // Network restricted environment (CI, local); fallback to empty — cover-fallback handles it
    return [];
  }
}
