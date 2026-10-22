const headers = { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' };
const reply = (statusCode, data, extra = {}) => ({ statusCode, headers: { ...headers, ...extra }, body: JSON.stringify(data) });
exports.handler = async event => {
  if (event.httpMethod !== 'GET') return reply(405, { error: 'Only GET requests are supported.' }, { Allow: 'GET' });
  const { action = 'popular', page = '1', query = '', id = '', genre = '', year_from = '', year_to = '', sort = '' } = event.queryStringParameters || {};
  if (!/^\d+$/.test(page) || Number(page) < 1 || Number(page) > 500) return reply(400, { error: 'Page must be between 1 and 500.' });
  const routes = { popular: '/movie/popular', trending: '/trending/movie/week', search: '/search/movie', genres: '/genre/movie/list', discover: '/discover/movie' };
  const movieActions = ['details', 'recommendations', 'similar'];
  if (!movieActions.includes(action) && !Object.hasOwn(routes, action)) return reply(400, { error: 'Unsupported catalog action.' });
  if (movieActions.includes(action) && (!/^[1-9]\d{0,9}$/.test(id))) return reply(400, { error: 'Invalid movie ID.' });
  if (action === 'search' && (!query.trim() || query.length > 150)) return reply(400, { error: 'Search must contain 1–150 characters.' });
  const genreIds = new Set([28,12,16,35,80,99,18,10751,14,36,27,10402,9648,10749,878,10770,53,10752,37]);
  if (genre !== '' && (!/^\d+$/.test(genre) || !genreIds.has(Number(genre)))) return reply(400, { error: 'Invalid movie genre.' });
  const sorts = new Set(['popularity.desc', 'vote_average.desc', 'vote_count.desc']);
  if (sort && !sorts.has(sort)) return reply(400, { error: 'Invalid movie sort.' });
  for (const year of [year_from, year_to]) {
    if (year !== '' && (!/^\d{4}$/.test(year) || Number(year) < 1800 || Number(year) > 2100)) return reply(400, { error: 'Release years must be between 1800 and 2100.' });
  }
  if (year_from && year_to && Number(year_from) > Number(year_to)) return reply(400, { error: 'From year must not exceed to year.' });
  if ((sort || year_from || year_to) && !['discover', 'popular', 'search', 'trending'].includes(action)) return reply(400, { error: 'Filters are not supported for this action.' });
  if (sort && ['search', 'trending'].includes(action)) return reply(400, { error: 'Search and Trending keep their TMDB ordering.' });
  const useDiscover = action === 'discover' || (action === 'popular' && Boolean(genre || sort || year_from || year_to));
  const token = process.env.TMDB_READ_TOKEN;
  if (!token || token === 'replace_with_your_read_access_token') return reply(503, { error: 'Catalog not configured. Set TMDB_READ_TOKEN in your local .env or Netlify environment variables, then restart or redeploy. See README.' });
  const url = new URL(`https://api.themoviedb.org/3${movieActions.includes(action) ? `/movie/${id}${action === 'details' ? '' : '/' + action}` : useDiscover ? '/discover/movie' : routes[action]}`);
  url.searchParams.set('language', 'en-US');
  if (['popular', 'trending', 'search', 'discover', 'recommendations', 'similar'].includes(action)) url.searchParams.set('page', page);
  if (useDiscover) {
    if (genre) url.searchParams.set('with_genres', genre);
    url.searchParams.set('sort_by', sort || 'popularity.desc');
    if (sort === 'vote_average.desc') url.searchParams.set('vote_count.gte', '1000');
    if (year_from) url.searchParams.set('primary_release_date.gte', `${year_from}-01-01`);
    if (year_to) url.searchParams.set('primary_release_date.lte', `${year_to}-12-31`);
    url.searchParams.set('include_video', 'false');
    url.searchParams.set('include_adult', 'false');
  }
  if (action === 'search') { url.searchParams.set('query', query.trim()); url.searchParams.set('include_adult', 'false'); }
  if (action === 'search' && year_from && year_from === year_to) url.searchParams.set('primary_release_year', year_from);
  try {
    const response = await fetch(url, { headers: { Authorization: `Bearer ${token}`, Accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
    if (!response.ok) {
      if (response.status === 429) return reply(429, { error: 'TMDB is busy. Please try again shortly.' }, { 'Retry-After': '10' });
      if ([401, 403].includes(response.status)) return reply(502, { error: 'TMDB authentication failed. Check the server token configuration.' });
      if (response.status === 404) return reply(404, { error: 'Movie not found.' });
      return reply(502, { error: 'TMDB is temporarily unavailable. Please try again.' });
    }
    const data = await response.json();
    // These TMDB endpoints lack Discover's range/genre filters. Filter each upstream
    // page at the proxy, preserving its pagination and relevance/trending order.
    if (['search', 'trending'].includes(action) && (genre || year_from || year_to) && Array.isArray(data.results)) {
      data.results = data.results.filter(movie => {
        const year = (movie.release_date || '').slice(0, 4);
        return (!genre || (movie.genre_ids || []).includes(Number(genre))) &&
          (!(year_from || year_to) || (/^\d{4}$/.test(year) && (!year_from || year >= year_from) && (!year_to || year <= year_to)));
      });
    }
    return reply(200, data);
  } catch {
    // Never log or forward request headers, tokens or raw upstream errors.
    return reply(502, { error: 'Could not reach TMDB. Please try again.' });
  }
};
