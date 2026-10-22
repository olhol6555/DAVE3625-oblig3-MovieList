/* Deterministic recommendation rules. No network, randomness, or AI services. */
(function (root) {
  const Store = typeof module !== 'undefined' ? require('./collection.js') : root.MovieCollection;
  function profile(collection, genreNames, preferences = []) {
    const byName = new Map([...genreNames].map(([id, name]) => [name, id]));
    const genreWeights = new Map();
    const signals = Store.feedback(collection);
    const liked = collection.watched.map(movie => {
      const favorite = Store.isFavorite(collection, movie);
      return { ...movie, favorite, weight: (Store.rating(movie.rating) >= 4 ? (movie.rating - 3) * 2 : 0) + (favorite ? 6 : 0) };
    }).filter(movie => movie.weight > 0).sort((a, b) => b.weight - a.weight || a.title.localeCompare(b.title) || (a.tmdbId || 0) - (b.tmdbId || 0));
    const combined = new Map(liked.map(movie => [movie.tmdbId || Store.identity(movie), movie]));
    signals.moreLike.forEach((movie, index) => {
      const existing = combined.get(movie.tmdbId);
      combined.set(movie.tmdbId, { ...movie, ...(existing || {}), feedback: true, feedbackRank: index, weight: (existing?.weight || 0) + 6 });
    });
    const weighted = [...combined.values()].filter(movie => !signals.dismissed.includes(movie.tmdbId)).sort((a, b) => Number(!!b.feedback) - Number(!!a.feedback) || (a.feedbackRank ?? Infinity) - (b.feedbackRank ?? Infinity) || b.weight - a.weight || a.title.localeCompare(b.title));
    for (const movie of weighted) for (const name of new Set(movie.genres || [])) {
      const id = byName.get(name);
      if (id) genreWeights.set(id, (genreWeights.get(id) || 0) + movie.weight);
    }
    const preferred = [...new Set(preferences.map(Number))].filter(id => genreNames.has(id));
    for (const id of preferred) genreWeights.set(id, (genreWeights.get(id) || 0) + 4);
    const genres = [...genreWeights].map(([id, weight]) => ({ id, weight, name: genreNames.get(id), preferred: preferred.includes(id) })).sort((a, b) => b.weight - a.weight || a.id - b.id);
    return { seeds: weighted.filter(movie => Number.isSafeInteger(movie.tmdbId) && movie.tmdbId > 0).slice(0, 4), genres: (preferred.length ? genres.filter(genre => genre.preferred) : genres).slice(0, 3), preferred, genreWeights, likedCount: weighted.length };
  }
  function sources(taste) {
    return [
      ...taste.seeds.flatMap(seed => ['recommendations', 'similar'].map(kind => ({ kind, seed, weight: seed.weight, parameters: { id: String(seed.tmdbId), page: '1' } }))),
      ...taste.genres.map(genre => ({ kind: 'discover', genre, weight: genre.weight, parameters: { genre: String(genre.id), page: '1' } }))
    ];
  }
  function rank(collection, taste, batches, limit = 40) {
    const dismissed = new Set(Store.feedback(collection).dismissed);
    const watched = new Set(collection.watched.filter(movie => movie.tmdbId).map(movie => movie.tmdbId));
    const legacy = collection.watched.filter(movie => !movie.tmdbId);
    const candidates = new Map();
    // Stable source order also makes ranking independent of response completion order.
    const ordered = [...batches].sort((a, b) => (a.kind + ':' + (a.seed?.tmdbId || a.genre?.id || '')).localeCompare(b.kind + ':' + (b.seed?.tmdbId || b.genre?.id || '')));
    const sourceKeys = new Set();
    const activeSeeds = new Map(taste.seeds.map(seed => [seed.tmdbId, seed]));
    const activeGenres = new Map(taste.genres.map(genre => [genre.id, genre]));
    for (const batch of ordered) {
      const seed = batch.seed ? activeSeeds.get(batch.seed.tmdbId) : null;
      const genre = batch.genre ? activeGenres.get(batch.genre.id) : null;
      if ((batch.seed && !seed) || (batch.genre && !genre)) continue;
      const weight = seed?.weight ?? genre?.weight ?? batch.weight;
      const sourceKey = batch.kind + ':' + (batch.seed?.tmdbId || batch.genre?.id || '');
      if (sourceKeys.has(sourceKey)) continue;
      sourceKeys.add(sourceKey);
      const seen = new Set();
      for (const [index, movie] of (batch.results || []).entries()) {
        const title = movie.title || movie.original_title || '';
        const year = (movie.release_date || '').slice(0, 4);
        if (!Number.isSafeInteger(movie.id) || movie.id <= 0 || movie.adult || !title || watched.has(movie.id) || dismissed.has(movie.id) || seen.has(movie.id)) continue;
        if (seed && movie.id === seed.tmdbId) continue;
        if (taste.preferred.length && !(movie.genre_ids || []).some(id => taste.preferred.includes(id))) continue;
        if (legacy.some(saved => saved.title.toLowerCase() === title.toLowerCase() && (!saved.year || saved.year === year))) continue;
        seen.add(movie.id);
        let candidate = candidates.get(movie.id);
        if (!candidate) { candidate = { movie, score: 0, evidence: [], feedbackRank: Infinity }; candidates.set(movie.id, candidate); }
        const strength = weight * (batch.kind === 'recommendations' ? 6 : batch.kind === 'similar' ? 3 : 1) / (1 + index / 20);
        const reason = seed ? seed.feedback ? `Because you asked for more like ${seed.title}` : seed.favorite ? `Because ${seed.title} is in your Top 4` : `Because you liked ${seed.title}` : genre.preferred ? `For your interest in ${genre.name}` : `You often rate ${genre.name} highly`;
        candidate.score += strength;
        const feedbackRank = seed?.feedback ? seed.feedbackRank : Infinity;
        candidate.feedbackRank = Math.min(candidate.feedbackRank, feedbackRank);
        candidate.evidence.push({ strength, reason, feedbackRank });
      }
    }
    return [...candidates.values()].map(candidate => {
      const affinity = [...new Set(candidate.movie.genre_ids || [])].reduce((sum, id) => sum + (taste.genreWeights.get(id) || 0), 0);
      const quality = Math.max(0, Math.min(10, Number(candidate.movie.vote_average) || 0)) / 10;
      candidate.evidence.sort((a, b) => a.feedbackRank - b.feedbackRank || b.strength - a.strength || a.reason.localeCompare(b.reason));
      return { ...candidate.movie, score: candidate.score + affinity * 2 + quality, recommendationReason: candidate.evidence[0].reason, feedbackPriority: candidate.feedbackRank };
    }).sort((a, b) => a.feedbackPriority - b.feedbackPriority || b.score - a.score || a.id - b.id).slice(0, limit);
  }
  const api = { profile, sources, rank };
  if (typeof module !== 'undefined') module.exports = api;
  else root.MovieRecommendations = api;
})(globalThis);
