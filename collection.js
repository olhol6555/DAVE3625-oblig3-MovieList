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
    result.favorites = validFavorites(result, data.favorites);
    if (data.recommendationFeedback) result.recommendationFeedback = feedback(data);
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
  // Stable references avoid duplicating movie data or losing legacy favorites on reload.
  function identity(movie) { return movie.tmdbId ? 'tmdb:' + movie.tmdbId : 'legacy:' + JSON.stringify([movie.title.toLowerCase(), String(movie.year || '')]); }
  function validFavorites(data, refs = data.favorites) {
    const watched = new Set(data.watched.map(identity));
    return [...new Set(Array.isArray(refs) ? refs : [])].filter(ref => watched.has(ref)).slice(0, 4);
  }
  function favorites(data) {
    return validFavorites(data).map(ref => data.watched.find(movie => identity(movie) === ref));
  }
  function isFavorite(data, movie) { return validFavorites(data).includes(identity(movie)); }
  function toggleFavorite(data, movie) {
    const refs = validFavorites(data), ref = identity(movie);
    if (refs.includes(ref)) { data.favorites = refs.filter(item => item !== ref); return true; }
    if (status(data, movie) !== 'watched' || refs.length >= 4) return false;
    data.favorites = [...refs, ref];
    return true;
  }
  function replaceFavorite(data, previous, movie) {
    const refs = validFavorites(data), index = refs.indexOf(identity(previous));
    if (index < 0 || status(data, movie) !== 'watched' || refs.includes(identity(movie))) return false;
    refs[index] = identity(movie); data.favorites = refs;
    return true;
  }
  function moveFavorite(data, movie, direction) {
    const refs = validFavorites(data), index = refs.indexOf(identity(movie)), next = index + direction;
    if (![-1, 1].includes(direction) || index < 0 || next < 0 || next >= refs.length) return false;
    [refs[index], refs[next]] = [refs[next], refs[index]];
    data.favorites = refs; return true;
  }
  function pickRandom(data, previous = null, random = Math.random) {
    const movies = data.watchlist;
    if (!movies.length) return null;
    const candidates = movies.length > 1 ? movies.filter(movie => !previous || identity(movie) !== identity(previous)) : movies;
    return candidates[Math.floor(random() * candidates.length)];
  }
  function same(a, b) {
    // Match legacy films by identity rather than a reused positional ID.
    if (!a.tmdbId && !b.tmdbId && !isTmdbId(a.id) && !isTmdbId(b.id)) return identity(a) === identity(b);
    return a.tmdbId && b.tmdbId ? a.tmdbId === b.tmdbId : a.id === b.id;
  }
  function status(data, movie) { return ['watched', 'watchlist'].find(list => data[list].some(item => same(item, movie))) || 'neutral'; }
  function find(data, movie) { return [...data.watched, ...data.watchlist].find(item => same(item, movie)); }
  function setStatus(data, movie, next) {
    if (!['neutral', 'watched', 'watchlist'].includes(next)) throw Error('Invalid status');
    const previous = find(data, movie);
    const previousStatus = status(data, movie);
    data.watched = data.watched.filter(item => !same(item, movie));
    data.watchlist = data.watchlist.filter(item => !same(item, movie));
    if (next !== 'neutral') data[next].push({ ...movie, ...(previous || {}), rating: next === 'watched' && previousStatus === 'watched' ? rating(previous.rating) : 0 });
    data.favorites = validFavorites(data);
  }
  function statusStamp(data, movie) {
    return JSON.stringify([status(data, movie), find(data, movie)?.rating || 0, isFavorite(data, movie)]);
  }
  function changeStatusWithUndo(data, movie, next) {
    const previous = find(data, movie);
    const token = { movie: { ...movie }, previous: previous ? { ...previous, genres: [...(previous.genres || [])] } : null,
      previousStatus: status(data, movie), index: previous ? data[status(data, movie)].indexOf(previous) : -1,
      favoriteIndex: validFavorites(data).indexOf(identity(movie)) };
    setStatus(data, movie, next);
    token.after = statusStamp(data, movie);
    return token;
  }
  function undoStatus(data, token) {
    if (!token || statusStamp(data, token.movie) !== token.after) return false;
    const refs = validFavorites(data).filter(ref => ref !== identity(token.movie));
    if (token.favoriteIndex >= 0 && refs.length >= 4) return false;
    const latest = find(data, token.movie);
    setStatus(data, token.movie, 'neutral');
    if (token.previous) {
      // Keep newly fetched metadata, but restore the original status, rating and order.
      const restored = { ...token.previous, ...(latest || {}), rating: token.previous.rating };
      data[token.previousStatus].splice(Math.min(token.index, data[token.previousStatus].length), 0, restored);
    }
    if (token.favoriteIndex >= 0) refs.splice(Math.min(token.favoriteIndex, refs.length), 0, identity(token.movie));
    data.favorites = validFavorites(data, refs);
    return true;
  }
  function feedback(data) {
    const raw = data.recommendationFeedback || {};
    const dismissed = [...new Set((Array.isArray(raw.dismissed) ? raw.dismissed : []).filter(isTmdbId))];
    const seen = new Set();
    const moreLike = (Array.isArray(raw.moreLike) ? raw.moreLike : []).map(clean).filter(movie => {
      if (!movie?.tmdbId || dismissed.includes(movie.tmdbId) || seen.has(movie.tmdbId)) return false;
      seen.add(movie.tmdbId); movie.rating = 0; return true;
    });
    return { dismissed, moreLike };
  }
  function feedbackState(data, movie) {
    const value = feedback(data);
    return value.dismissed.includes(movie.tmdbId) ? 'dismissed' : value.moreLike.some(item => item.tmdbId === movie.tmdbId) ? 'moreLike' : 'neutral';
  }
  function setFeedback(data, movie, next) {
    if (!isTmdbId(movie.tmdbId) || !['dismissed', 'moreLike', 'neutral'].includes(next)) return null;
    const value = feedback(data), previous = feedbackState(data, movie);
    const index = value.moreLike.findIndex(item => item.tmdbId === movie.tmdbId);
    const token = { movie: { ...(index >= 0 ? value.moreLike[index] : movie) }, previous, index, after: next };
    value.dismissed = value.dismissed.filter(id => id !== movie.tmdbId);
    value.moreLike = value.moreLike.filter(item => item.tmdbId !== movie.tmdbId);
    if (next === 'dismissed') value.dismissed.push(movie.tmdbId);
    if (next === 'moreLike') value.moreLike.unshift({ ...clean(movie, 0), rating: 0 });
    data.recommendationFeedback = value;
    return token;
  }
  function undoFeedback(data, token) {
    if (!token || feedbackState(data, token.movie) !== token.after) return false;
    setFeedback(data, token.movie, token.previous);
    if (token.previous === 'moreLike') {
      const list = data.recommendationFeedback.moreLike;
      const restored = list.shift(); list.splice(Math.min(token.index, list.length), 0, restored);
    }
    return true;
  }
  // Linking is explicit: a title match alone must never merge unrelated remakes.
  function link(data, legacy, tmdb) {
    const old = find(data, legacy);
    if (!old) return;
    const oldFavorites = validFavorites(data);
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
    data.favorites = validFavorites(data, oldFavorites.map(ref => ref === identity(old) ? identity(tmdb) : ref));
  }
  // Derived, read-only statistics: never infer ratings or genres for missing metadata.
  function statistics(data) {
    const watched = data.watched;
    const rated = watched.filter(movie => rating(movie.rating) > 0);
    const genres = new Map(), decades = new Map();
    const distribution = Array.from({ length: 10 }, (_, index) => ({ rating: (index + 1) / 2, count: 0 }));
    let missingGenres = 0, missingYears = 0;
    for (const movie of watched) {
      const names = new Set((movie.genres || []).filter(name => typeof name === 'string' && name.trim()).map(name => name.trim()));
      if (!names.size) missingGenres++;
      for (const name of names) genres.set(name, (genres.get(name) || 0) + 1);
      if (/^\d{4}$/.test(String(movie.year)) && Number(movie.year) >= 1800) {
        const decade = Math.floor(Number(movie.year) / 10) * 10;
        decades.set(decade, (decades.get(decade) || 0) + 1);
      } else missingYears++;
      const value = rating(movie.rating);
      if (value) distribution[value * 2 - 1].count++;
    }
    return {
      watchedCount: watched.length, watchlistCount: data.watchlist.length,
      ratedCount: rated.length,
      averageRating: rated.length ? rated.reduce((sum, movie) => sum + movie.rating, 0) / rated.length : null,
      genres: [...genres].map(([name, count]) => ({ name, count })).sort((a, b) => b.count - a.count || a.name.localeCompare(b.name)),
      ratingDistribution: distribution,
      decades: [...decades].sort((a, b) => a[0] - b[0]).map(([decade, count]) => ({ name: decade + 's', count })),
      missingGenres, missingYears,
      highestRated: [...rated].sort((a, b) => b.rating - a.rating || a.title.localeCompare(b.title)).slice(0, 8)
    };
  }
  const api = { KEY, rating, load, normalize, status, find, setStatus, link, identity, favorites, isFavorite, toggleFavorite, replaceFavorite, moveFavorite, pickRandom, statistics, changeStatusWithUndo, undoStatus, feedback, feedbackState, setFeedback, undoFeedback };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MovieCollection = api;
})(globalThis);

