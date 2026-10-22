/* Shared collection logic. No network calls or credentials. */
(function (root) {
  const KEY = 'movielist-v2';
  const rating = value => typeof value === 'number' && value >= 0.5 && value <= 5 && Number.isInteger(value * 2) ? value : 0;
  const isTmdbId = id => Number.isSafeInteger(id) && id > 0;
  function clean(movie, index) {
    if (!movie || typeof movie.title !== 'string' || !movie.title.trim()) return null;
    const id = isTmdbId(movie.tmdbId) ? movie.tmdbId : isTmdbId(movie.id) ? movie.id : null;
    return { id: id || `legacy-${index}`, tmdbId: id, title: movie.title.trim(), year: String(movie.year || ''), poster_path: typeof movie.poster_path === 'string' ? movie.poster_path : null, overview: typeof movie.overview === 'string' ? movie.overview : '', genres: Array.isArray(movie.genres) ? movie.genres.filter(g => typeof g === 'string') : [], rating: rating(movie.rating) };
  }
  function normalize(data) {
    if (!data || !Array.isArray(data.watched) || !Array.isArray(data.watchlist)) throw Error('Invalid collection');
    const result = { watched: [], watchlist: [] };
    const seen = new Set();
    let index = 0;
    for (const list of ['watched', 'watchlist']) {
      for (const item of data[list]) {
        const movie = clean(item, index++);
        if (!movie) continue;
        const identity = movie.tmdbId ? `tmdb:${movie.tmdbId}` : `legacy:${movie.title.toLowerCase()}:${movie.year}`;
        if (seen.has(identity)) continue;
        seen.add(identity);
        if (list === 'watchlist') movie.rating = 0;
        result[list].push(movie);
      }
    }
    return result;
  }
  function load(storage) {
    const current = storage.getItem(KEY);
    if (current !== null) return normalize(JSON.parse(current));
    const v1 = storage.getItem('movielist-v1');
    if (v1 !== null) return normalize(JSON.parse(v1));
    const legacy = storage.getItem('movies');
    return normalize({ watched: legacy !== null ? JSON.parse(legacy) : [], watchlist: [] });
  }
  function same(a, b) { return a.tmdbId && b.tmdbId ? a.tmdbId === b.tmdbId : a.id === b.id; }
  function status(data, movie) { return ['watched', 'watchlist'].find(list => data[list].some(item => same(item, movie))) || 'neutral'; }
  function find(data, movie) { return [...data.watched, ...data.watchlist].find(item => same(item, movie)); }
  function setStatus(data, movie, next) {
    if (!['neutral', 'watched', 'watchlist'].includes(next)) throw Error('Invalid status');
    const previous = find(data, movie);
    const previousStatus = status(data, movie);
    data.watched = data.watched.filter(item => !same(item, movie));
    data.watchlist = data.watchlist.filter(item => !same(item, movie));
    if (next !== 'neutral') data[next].push({ ...movie, ...(previous || {}), rating: next === 'watched' && previousStatus === 'watched' ? rating(previous.rating) : 0 });
  }
  // Linking is explicit: a title match alone must never merge unrelated remakes.
  function link(data, legacy, tmdb) {
    const old = find(data, legacy);
    if (!old) return;
    const list = status(data, old);
    const existing = find(data, tmdb);
    if (existing) {
      const wasWatched = status(data, existing) === 'watched';
      const mergedRating = wasWatched && existing.rating ? existing.rating : list === 'watched' ? old.rating : 0;
      const target = wasWatched || list === 'watched' ? 'watched' : 'watchlist';
      setStatus(data, tmdb, target);
      find(data, tmdb).rating = mergedRating;
    } else {
      data[list].push({ ...tmdb, rating: list === 'watched' ? old.rating : 0 });
    }
    data.watched = data.watched.filter(item => !same(item, legacy));
    data.watchlist = data.watchlist.filter(item => !same(item, legacy));
  }
  const api = { KEY, rating, load, normalize, status, find, setStatus, link };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MovieCollection = api;
})(globalThis);

