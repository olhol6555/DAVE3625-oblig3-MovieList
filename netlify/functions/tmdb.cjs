const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, data, extra = {}) => ({ statusCode, headers: { ...headers, ...extra }, body: JSON.stringify(data) });
exports.handler = async event => {
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Only GET requests are supported.' }, { Allow: 'GET' });
  const { action = 'popular', page = '1', query = '', id = '', genre = '' } = event.queryStringParameters || {};
  if (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 500) return reply(400, { error: 'Page must be between 1 and 500.' });
  const routes = { popular: '/movie/popular', trending: '/trending/movie/week', search: '/search/movie', genres: '/genre/movie/list' };
  if (action !== 'details' && !Object.hasOwn(routes, action)) return reply(400, { error: 'Unsupported catalog action.' });
  if (action === 'details' && (!/^[1-9]\d{0,9}$/.test(id))) return reply(400, { error: 'Invalid movie ID.' });
  if (action === 'search' && (!query.trim() || query.length > 150)) return reply(400, { error: 'Search must contain 1–150 characters.' });
  const genreIds = new Set([28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37]);
  if (genre !== '' && (!/^\d+$/.test(genre) || !genreIds.has(Number(genre)))) return reply(400, { error: 'Invalid movie genre.' });
  const token = process.env.TMDB_READ_TOKEN;
  if (!token || token === 'replace_with_your_read_access_token') return reply(503, { error: 'Catalog not configured. Set TMDB_READ_TOKEN in your local .env or Netlify environment variables, then restart or redeploy. See README.' });
  const url = new URL(`https://api.themoviedb.org/3${action === 'details' ? `/movie/${id}` : action === 'popular' && genre ? '/discover/movie' : routes[action]}`);
  url.searchParams.set('language', 'en-US');
  if (['popular', 'trending', 'search'].includes(action)) url.searchParams.set('page', page);
  if (action === 'popular' && genre) {
    url.searchParams.set('with_genres', genre);
    url.searchParams.set('sort_by', 'popularity.desc');
    url.searchParams.set('include_adult', 'false');
  }
  if (action === 'search') { url.searchParams.set('query', query.trim()); url.searchParams.set('include_adult', 'false'); }
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      if (response.status === 429) return reply(429, { error: 'TMDB is busy. Please try again shortly.' }, { 'Retry-After': '10' });
      if ([401, 403].includes(response.status)) return reply(502, { error: 'TMDB authentication failed. Check the server token configuration.' });
      if (response.status === 404) return reply(404, { error: 'Movie not found.' });
      return reply(502, { error: 'TMDB is temporarily unavailable. Please try again.' });
    }
    return reply(200, await response.json());
  } catch {
    // Never log or forward request headers, tokens or raw upstream errors.
    return reply(502, { error: 'Could not reach TMDB. Please try again.' });
  }
};
