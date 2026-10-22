const $ = id => document.getElementById(id);
const Store = MovieCollection;
const element = (tag, className = '', text) => {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
};
function button(text, handler, className = 'secondary-button') {
  const node = element('button', className, text);
  node.type = 'button';
  node.addEventListener('click', handler);
  return node;
}
// All label variants participate in intrinsic sizing; only the current value is spoken.
function stableLabel(variants, className = '') {
  const wrapper = element('span', 'stable-label ' + className);
  wrapper.valueNode = element('span', 'label-value', variants[0]);
  wrapper.append(wrapper.valueNode);
  for (const text of new Set(variants)) {
    const reserve = element('span', 'label-reserve', text);
    reserve.setAttribute('aria-hidden', 'true');
    wrapper.append(reserve);
  }
  return wrapper;
}
function announce(text) { $('status').textContent = text; }
let collection = { watched: [], watchlist: [] };
let storageLocked = false;
let pendingUndo = null;
try { collection = Store.load(localStorage); }
catch {
  storageLocked = true;
  announce('Saved data could not be read. It has been left untouched. New changes are temporary until storage is available and the page is reloaded.');
}
function persist(message, interaction = false) {
  const x = window.scrollX, y = window.scrollY;
  const focused = document.activeElement;
  if (interaction) {
    for (const id of ['movie-container', 'watchlist-container', 'highest-rated', 'genre-chart', 'rating-chart', 'decade-chart', 'recommendation-container', 'related-container']) {
      const grid = $(id);
      if (grid) grid.style.minHeight = Math.ceil(grid.getBoundingClientRect().height) + 'px';
    }
  }
  render();
  if (interaction) {
    if (focused?.isConnected && !focused.disabled && document.activeElement !== focused) focused.focus({ preventScroll: true });
    if (focused && (!focused.isConnected || focused.disabled)) {
      const target = $('movie-dialog').open ? $('close-dialog') : $('movie-search') || $('refresh-recommendations');
      target?.focus({ preventScroll: true });
    }
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
  if (storageLocked) { announce('Change shown for this session only. Existing unreadable storage was left untouched.'); return; }
  try { localStorage.setItem(Store.KEY, JSON.stringify(collection)); announce(message); }
  catch { announce('Change shown, but could not be saved. Browser storage may be disabled or full.'); }
}
function updateUndoUI() {
  const toast = $('undo-toast');
  if (toast) toast.hidden = !pendingUndo;
  if ($('undo-message')) $('undo-message').textContent = pendingUndo?.message || '';
  if ($('dialog-undo')) {
    $('dialog-undo').disabled = !pendingUndo;
    $('dialog-undo').setAttribute('aria-label', pendingUndo ? 'Undo: ' + pendingUndo.message : 'No action to undo');
  }
  if ($('related-undo')) {
    $('related-undo').disabled = !pendingUndo;
    $('related-undo').setAttribute('aria-label', pendingUndo ? 'Undo: ' + pendingUndo.message : 'No action to undo');
  }
}
function offerUndo(action) { pendingUndo = action; updateUndoUI(); }
function clearUndo() { pendingUndo = null; updateUndoUI(); }
function undoLastAction() {
  if (!pendingUndo) return;
  const action = pendingUndo;
  clearUndo();
  let restored = false;
  if (action.kind === 'status') {
    restored = Store.undoStatus(collection, action.token);
    if (restored && action.pickerMovie && Store.status(collection, action.pickerMovie) === 'watchlist') pickedMovie = Store.find(collection, action.pickerMovie);
  } else if (action.kind === 'feedback') restored = Store.undoFeedback(collection, action.token);
  else if (action.kind === 'feedbackReset' && JSON.stringify(Store.feedback(collection)) === action.after) {
    collection.recommendationFeedback = action.previous;
    restored = true;
  }
  if (restored) persist('Change undone.', true);
  else announce('That item has changed since this action. Undo was skipped to preserve your newer changes.');
}
function changeRecommendationFeedback(movie, next) {
  const token = Store.setFeedback(collection, movie, next);
  if (!token) return;
  if (next === 'moreLike') openRelatedPicks(movie);
  const message = next === 'dismissed' ? movie.title + ': hidden from For You.' : next === 'moreLike' ? 'We’ll find more films like ' + movie.title + '.' : 'Removed the extra recommendation signal for ' + movie.title + '.';
  persist('', true);
  offerUndo({ kind: 'feedback', token, message });
}
function resetRecommendationFeedback() {
  const previous = Store.feedback(collection);
  if (!previous.dismissed.length && !previous.moreLike.length) return;
  collection.recommendationFeedback = { dismissed: [], moreLike: [] };
  persist('', true);
  offerUndo({ kind: 'feedbackReset', previous, after: JSON.stringify(Store.feedback(collection)), message: 'Recommendation feedback reset. Hidden films can appear again.' });
}
// TMDB's movie genre taxonomy also keeps saved-film filters available offline.
let genreNames = new Map([[28,"Action"],[12,"Adventure"],[16,"Animation"],[35,"Comedy"],[80,"Crime"],[99,"Documentary"],[18,"Drama"],[10751,"Family"],[14,"Fantasy"],[36,"History"],[27,"Horror"],[10402,"Music"],[9648,"Mystery"],[10749,"Romance"],[878,"Science Fiction"],[10770,"TV Movie"],[53,"Thriller"],[10752,"War"],[37,"Western"]]);
function matchesGenre(movie, id) {
  if (!id) return true;
  const name = genreNames.get(Number(id));
  return (movie.genres || []).includes(name);
}
let customYearRange = null;
let catalog = [], mode = 'popular', searchQuery = '', page = 0, totalPages = 0;
let requestId = 0, controller, busy = false, failed = false;
let activeMovie = null, detailRequest = 0, linkingMovie = null;
let pickedMovie = null, pickerStarted = false, pendingFavorite = null;
const detailCache = new Map();
let recommendationBatches = [], recommendationPreferences = [], recommendationInput = '';
let recommendationBusy = false, recommendationError = '', recommendationRequest = 0, recommendationController;
let relatedFocus = null, relatedProgress = new Map();

async function api(action, parameters = {}, signal) {
  const response = await fetch(`/.netlify/functions/tmdb?${new URLSearchParams({ action, ...parameters })}`, { signal });
  let data;
  try { data = await response.json(); } catch { throw Error('Catalog requires Netlify Dev or a Netlify deployment. See README for setup.'); }
  if (!response.ok) throw Error(data.error || 'Could not load films. Please try again.');
  return data;
}
function fromTmdb(movie) {
  return { id: movie.id, tmdbId: movie.id, title: movie.title || movie.original_title || 'Untitled film', year: (movie.release_date || '').slice(0, 4), poster_path: movie.poster_path || null, overview: movie.overview || '', genres: movie.genres ? movie.genres.map(g => g.name) : (movie.genre_ids || []).map(id => genreNames.get(id)).filter(Boolean), rating: 0 };
}
function poster(movie, lazy = true) {
  const wrapper = element('div', 'real-poster');
  const fallback = element('span', 'poster-fallback', `${movie.title}\nPoster unavailable`);
  wrapper.append(fallback);
  if (typeof movie.poster_path === 'string' && /^\/[a-zA-Z0-9._-]+$/.test(movie.poster_path)) {
    const img = document.createElement('img');
    img.alt = `${movie.title} poster`;
    img.loading = lazy ? 'lazy' : 'eager';
    img.src = `https://image.tmdb.org/t/p/w500${movie.poster_path}`;
    img.addEventListener('error', () => img.remove());
    wrapper.append(img);
  }
  return wrapper;
}
const statusLabel = { neutral: 'Not added', watched: '✓ Watched', watchlist: 'In Watchlist' };
function changeStatus(movie, next) {
  const pickerMovie = pickedMovie && Store.identity(pickedMovie) === Store.identity(movie) ? { ...pickedMovie } : null;
  const token = Store.changeStatusWithUndo(collection, movie, next);
  persist('', true);
  offerUndo({ kind: 'status', token, pickerMovie, message: `${movie.title}: ${statusLabel[next]}.` });
}
function changeRating(movie, value) {
  const saved = Store.find(collection, movie);
  if (!saved || Store.status(collection, movie) !== 'watched') return;
  saved.rating = Store.rating(value);
  persist(`${movie.title}: ${saved.rating ? saved.rating + ' / 5 stars' : 'rating cleared'}.`, true);
}
function controls(movie) {
  const box = element('div', 'movie-controls');
  const actions = element('div', 'card-actions status-actions');
  const statusButtons = ['watched', 'watchlist'].map(next => {
    const control = button(next === 'watched' ? '✓ Watched' : '＋ Watchlist', () => {
      changeStatus(movie, Store.status(collection, movie) === next ? 'neutral' : next);
    }, `status-button action-${next}`);
    const icon = element('span', 'status-icon', next === 'watched' ? '✓' : '');
    icon.setAttribute('aria-hidden', 'true');
    const label = stableLabel(next === 'watched' ? ['Watched'] : ['Watchlist', 'In Watchlist'], 'status-label');
    control.textContent = '';
    control.append(icon, label);
    control.statusLabel = label.valueNode;
    actions.append(control);
    return control;
  });
  const rating = element('div', 'star-rating');
  const caption = element('div', 'rating-caption');
  const valueLabel = stableLabel(['Your rating · optional', ...Array.from({ length: 10 }, (_, index) => `Your rating · ${(index + 1) / 2} / 5`)], 'rating-value');
  const clear = button('Clear', () => changeRating(movie, 0), 'clear-rating');
  clear.setAttribute('aria-label', `Clear rating for ${movie.title}`);
  caption.append(valueLabel, clear);
  const stars = element('div', 'stars');
  stars.setAttribute('role', 'radiogroup');
  stars.setAttribute('aria-label', `Your rating for ${movie.title}`);
  const choices = [], fills = [];
  const current = () => Store.find(collection, movie)?.rating || 0;
  function preview(value) {
    fills.forEach((fill, i) => { fill.style.clipPath = `inset(0 ${100 - Math.max(0, Math.min(1, value - i)) * 100}% 0 0)`; });
  }
  for (let i = 0; i < 5; i++) {
    const star = element('div', 'star');
    const outline = element('span', 'star-outline', '★');
    const fill = element('span', 'star-fill', '★');
    outline.setAttribute('aria-hidden', 'true'); fill.setAttribute('aria-hidden', 'true');
    fills.push(fill); star.append(outline, fill);
    for (let half = 1; half <= 2; half++) {
      const value = i + half / 2;
      const hit = button('', () => changeRating(movie, value), `star-hit star-half-${half}`);
      hit.setAttribute('role', 'radio');
      hit.setAttribute('aria-label', `${value} out of 5 stars`);
      hit.addEventListener('pointerenter', () => preview(value));
      hit.addEventListener('focus', () => preview(value));
      hit.addEventListener('blur', () => preview(current()));
      hit.addEventListener('keydown', event => {
        const index = choices.indexOf(hit);
        let next;
        if (['ArrowRight', 'ArrowUp'].includes(event.key)) next = (index + 1) % 10;
        if (['ArrowLeft', 'ArrowDown'].includes(event.key)) next = (index + 9) % 10;
        if (event.key === 'Home') next = 0;
        if (event.key === 'End') next = 9;
        if (event.key === 'Delete' || event.key === 'Backspace') { event.preventDefault(); changeRating(movie, 0); }
        if (next !== undefined) {
          event.preventDefault(); changeRating(movie, (next + 1) / 2);
          choices[next].focus({ preventScroll: true });
        }
      });
      choices.push(hit); star.append(hit);
    }
    stars.append(star);
  }
  stars.addEventListener('pointerleave', () => preview(current()));
  rating.append(caption, stars);
  box.append(actions, rating);
  const favorite = button('', () => toggleFavorite(movie), 'favorite-button');
  const favoriteLabel = stableLabel(['♡ Add to Favorites', '♥ In Favorites'], 'favorite-label');
  favorite.append(favoriteLabel);
  box.append(favorite);
  box.updateControls = () => {
    const state = Store.status(collection, movie), value = current();
    statusButtons.forEach((control, i) => {
      const next = i ? 'watchlist' : 'watched';
      control.statusLabel.textContent = next === 'watched' ? 'Watched' : state === next ? 'In Watchlist' : 'Watchlist';
      control.setAttribute('aria-pressed', String(state === next));
      control.setAttribute('aria-label', `${movie.title}: ${state === next ? 'remove from' : 'add to'} ${next}`);
    });
    favorite.style.visibility = state === 'watched' ? 'visible' : 'hidden';
    favorite.disabled = state !== 'watched';
    const selected = Store.isFavorite(collection, movie);
    favoriteLabel.valueNode.textContent = selected ? '♥ In Favorites' : '♡ Add to Favorites';
    favorite.setAttribute('aria-pressed', String(selected));
    favorite.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${movie.title} ${selected ? 'from' : 'to'} favorites`);
    // Reserve the same space in every card so status changes never resize rows.
    rating.style.visibility = state === 'watched' ? 'visible' : 'hidden';
    rating.inert = state !== 'watched';
    valueLabel.valueNode.textContent = value ? `Your rating · ${value} / 5` : 'Your rating · optional';
    clear.disabled = !value;
    choices.forEach((hit, i) => {
      hit.setAttribute('aria-checked', String(value === (i + 1) / 2));
      hit.tabIndex = i === (value ? value * 2 - 1 : 0) ? 0 : -1;
    });
    preview(value);
  };
  box.updateControls();
  return box;
}
function updateControlsWithin(node) {
  if (node.updateControls) node.updateControls();
  for (const child of node.children) updateControlsWithin(child);
}
function syncCards(container, movies, inCatalog = false) {
  const old = new Map([...container.children].filter(node => node.movieKey).map(node => [node.movieKey, node]));
  const nodes = movies.map(movie => {
    const key = movie.tmdbId ? 'tmdb:' + movie.tmdbId : 'legacy:' + movie.id;
    const signature = JSON.stringify({ ...movie, rating: 0 });
    const existing = old.get(key);
    const node = existing?.movieSignature === signature ? existing : card(movie, inCatalog);
    node.movieKey = key;
    node.movieSignature = signature;
    updateControlsWithin(node);
    if ($('statistics')) {
      const score = [...node.children[1].children].find(child => child.className === 'personal-score');
      if (score) score.textContent = `★ ${Store.find(collection, movie)?.rating || 0} / 5`;
    }
    return node;
  });
  for (const child of [...container.children]) if (!nodes.includes(child)) child.remove();
  nodes.forEach((node, index) => { if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); });
}
function card(movie, inCatalog = false) {
  const node = element('article', 'movie-card');
  const open = button('', () => openDetails(movie), 'movie-open');
  open.setAttribute('aria-label', `View details for ${movie.title}`);
  open.append(poster(movie));
  const body = element('div', 'card-body');
  const title = button(movie.title, () => openDetails(movie), 'title-button');
  body.append(title, element('p', 'film-year', movie.year || 'Release date unknown'));
  if (movie.recommendationReason) {
    body.append(element('p', 'recommendation-reason', movie.recommendationReason), element('p', 'recommendation-description', movie.overview || 'A new story to discover. Open details to learn more.'));
  }
  if ($('statistics')) body.append(element('p', 'personal-score', `★ ${Store.find(collection, movie)?.rating || movie.rating} / 5`));
  if (inCatalog && linkingMovie) body.append(button('Link this film', () => {
    Store.link(collection, linkingMovie, movie);
    finishLink();
    persist(`Saved film linked to ${movie.title}.`);
  }, 'button'));
  else body.append(controls(movie));
  if (movie.recommendationReason) {
    const feedback = element('div', 'recommendation-feedback');
    const more = button('', () => changeRecommendationFeedback(movie, Store.feedbackState(collection, movie) === 'moreLike' ? 'neutral' : 'moreLike'), 'secondary-button feedback-more');
    const label = stableLabel(['＋ More like this', '✓ More like this']);
    more.append(label);
    const dismiss = button('⊘ Not interested', () => changeRecommendationFeedback(movie, 'dismissed'), 'secondary-button feedback-dismiss');
    dismiss.setAttribute('aria-label', 'Not interested in ' + movie.title);
    feedback.append(more, dismiss);
    feedback.updateControls = () => {
      const selected = Store.feedbackState(collection, movie) === 'moreLike';
      more.setAttribute('aria-pressed', String(selected));
      more.setAttribute('aria-label', (selected ? 'Stop prioritizing films like ' : 'Find more films like ') + movie.title);
      label.valueNode.textContent = selected ? '✓ More like this' : '＋ More like this';
    };
    feedback.updateControls();
    body.append(feedback);
  }
  if (!movie.tmdbId) body.append(button('Find in TMDB', () => beginLink(movie)));
  node.append(open, body);
  return node;
}
function renderCatalog() {
  if (!$('catalog-container')) return;
  syncCards($('catalog-container'), catalog, true);
  $('load-more').hidden = page >= totalPages || failed;
  $('load-more').disabled = busy;
  $('load-more').textContent = busy ? 'Loading…' : 'Load more';
  $('retry-catalog').hidden = !failed;
}
function renderBarChart(container, entries, emptyText) {
  if (!entries.length) {
    container.replaceChildren(element('p', 'empty-state', emptyText));
    return;
  }
  const max = Math.max(1, ...entries.map(entry => entry.count));
  const list = element('ul', 'bar-chart');
  for (const entry of entries) {
    const row = element('li', 'chart-row');
    const label = element('span', 'chart-label', entry.name);
    const track = element('span', 'chart-track');
    track.setAttribute('aria-hidden', 'true');
    const fill = element('span', 'chart-fill');
    fill.style.width = entry.count / max * 100 + '%';
    track.append(fill);
    const count = element('span', 'chart-count', String(entry.count));
    count.append(element('span', 'sr-only', entry.count === 1 ? ' movie' : ' movies'));
    row.append(label, track, count); list.append(row);
  }
  container.replaceChildren(list);
}
function renderStatistics(summary) {
  const container = $('statistics');
  if (!container) return;
  $('rated-count').textContent = summary.ratedCount;
  $('rated-summary').textContent = `${summary.watchedCount - summary.ratedCount} watched films unrated`;
  const signature = JSON.stringify(summary);
  if (container.statisticsSignature === signature) return;
  container.statisticsSignature = signature;
  renderBarChart($('genre-chart'), summary.genres, summary.watchedCount ? 'No genre information saved yet. Open your watched films’ details to fill in their TMDB metadata.' : 'Your taste starts with a film. Mark a movie as watched to explore your genres.');
  $('genre-note').textContent = summary.missingGenres ? `${summary.missingGenres} watched film(s) have no saved genre information and are excluded from this chart.` : '';
  renderBarChart($('rating-chart'), summary.ratedCount ? summary.ratingDistribution.map(bin => ({ name: bin.rating + ' ★', count: bin.count })) : [], 'No ratings yet. Give a watched film a star rating to see your distribution.');
  $('rating-summary').textContent = summary.averageRating === null ? 'Only your personal ratings are included.' : `${summary.averageRating.toFixed(1)} / 5 average · ${summary.ratedCount} rated films`;
  renderBarChart($('decade-chart'), summary.decades, 'Release decades will appear when watched films have saved release years.');
  $('decade-note').textContent = summary.missingYears ? `${summary.missingYears} watched film(s) have no valid saved release year.` : '';
  syncCards($('highest-rated'), summary.highestRated);
  if (!summary.highestRated.length) $('highest-rated').append(element('p', 'empty-state', 'Your favorites deserve a few stars. Rate a watched film to see it here.'));
  $('stats-update').textContent = `Statistics updated: ${summary.watchedCount} watched, ${summary.watchlistCount} on watchlist, ${summary.ratedCount} rated.`;
}
function recommendationSignature() {
  return JSON.stringify({ watched: collection.watched, favorites: collection.favorites, feedback: collection.recommendationFeedback, preferences: recommendationPreferences });
}
function setupRecommendationPreferences() {
  const container = $('preference-options');
  if (!container) return;
  for (const [id, name] of genreNames) {
    const choice = button(name, () => {
      if (recommendationPreferences.includes(id)) recommendationPreferences = recommendationPreferences.filter(value => value !== id);
      else if (recommendationPreferences.length < 3) recommendationPreferences.push(id);
      else { announce('Choose up to three genres. Deselect one to make room.'); return; }
      for (const node of container.children) node.setAttribute('aria-pressed', String(recommendationPreferences.includes(node.genreId)));
      loadRecommendations();
    }, 'genre-chip');
    choice.genreId = id;
    choice.setAttribute('aria-pressed', 'false');
    container.append(choice);
  }
}
function openRelatedPicks(movie) {
  relatedFocus = { ...movie };
  $('related-title').textContent = 'Because you liked ' + movie.title;
  $('related-message').textContent = 'Finding films connected to ' + movie.title + '…';
  if (!$('related-dialog').open) $('related-dialog').showModal();
}
function renderRelatedPicks(taste) {
  const dialog = $('related-dialog');
  if (!dialog || !relatedFocus) return;
  if (Store.feedbackState(collection, relatedFocus) !== 'moreLike') {
    if (dialog.open) dialog.close();
    relatedFocus = null;
    $('related-container').replaceChildren();
    return;
  }
  $('related-title').textContent = 'Because you liked ' + relatedFocus.title;
  const progress = relatedProgress.get(relatedFocus.tmdbId);
  const loading = progress && progress.completed < progress.total;
  const batches = recommendationBatches.filter(batch => batch.seed?.tmdbId === relatedFocus.tmdbId && ['recommendations','similar'].includes(batch.kind));
  const ranked = MovieRecommendations.rank(collection, taste, batches, 8);
  syncCards($('related-container'), ranked.map(movie => ({...fromTmdb(movie), recommendationReason: movie.recommendationReason})));
  $('related-container').setAttribute('aria-busy', String(!!loading));
  $('related-message').textContent = loading ? ranked.length ? 'Related picks are ready. Checking the remaining movie source…' : 'Finding films connected to ' + relatedFocus.title + '…' : ranked.length ? ranked.length + ' related picks · boosted in your For You feed. Your selected mood still applies.' : progress?.failed ? 'Related films could not be loaded. Try again; your feedback is saved.' : 'No unseen related films match your current mood. Try clearing a mood filter or choosing another film.';
  $('related-error').textContent = progress?.failed && ranked.length ? 'One related-movie source is unavailable. Showing the other source’s picks.' : '';
  $('related-retry').disabled = !!loading;
  if (!ranked.length) $('related-container').append(element('p', 'empty-state', loading ? 'Your related picks are on their way.' : 'Watched and hidden films stay excluded.'));
}
async function loadRecommendations() {
  const container = $('recommendation-container');
  if (!container) return;
  if (container.children.length) container.style.minHeight = Math.ceil(container.getBoundingClientRect().height) + 'px';
  recommendationController?.abort();
  const controller = new AbortController();
  recommendationController = controller;
  const current = ++recommendationRequest;
  recommendationInput = recommendationSignature();
  const taste = MovieRecommendations.profile(collection, genreNames, recommendationPreferences);
  const tasks = MovieRecommendations.sources(taste);
  const key = source => source.kind + ':' + (source.seed?.tmdbId || source.genre?.id);
  const active = new Set(tasks.map(key));
  recommendationBatches = recommendationBatches.filter(batch => active.has(key(batch)));
  relatedProgress = new Map(taste.seeds.map(seed => [seed.tmdbId, {total:2,completed:0,failed:0}]));
  recommendationBusy = tasks.length > 0;
  recommendationError = '';
  if (!tasks.length) recommendationBatches = [];
  renderRecommendations();
  if (!tasks.length) return;
  const batches = [];
  let failures = 0;
  for (let index = 0; index < tasks.length; index += 3) {
    if (current !== recommendationRequest) return;
    await Promise.allSettled(tasks.slice(index, index + 3).map(async source => {
      const progress = source.seed ? relatedProgress.get(source.seed.tmdbId) : null;
      try {
        const data = await api(source.kind, source.parameters, controller.signal);
        if (current !== recommendationRequest) return;
        if (!Array.isArray(data.results)) throw Error('Unexpected recommendation response.');
        const batch = { ...source, results: data.results };
        batches.push(batch);
        recommendationBatches = [...recommendationBatches.filter(previous => key(previous) !== key(batch)), batch];
      } catch {
        if (current !== recommendationRequest) return;
        failures++;
        if (progress) progress.failed++;
      }
      if (current !== recommendationRequest) return;
      if (progress) progress.completed++;
      // Publish each related source immediately, without waiting for the rest of the feed.
      renderRecommendations();
    }));
  }
  if (current !== recommendationRequest) return;
  recommendationBatches = batches;
  recommendationBusy = false;
  recommendationError = failures ? batches.length ? 'Some movie sources could not be loaded. Showing the available results; refresh to try again.' : 'Recommendations are unavailable. Check your connection and TMDB setup, then refresh to try again.' : '';
  renderRecommendations();
}
function renderRecommendations() {
  const container = $('recommendation-container');
  if (!container) return;
  if (recommendationInput !== recommendationSignature()) { loadRecommendations(); return; }
  const taste = MovieRecommendations.profile(collection, genreNames, recommendationPreferences);
  const ranked = MovieRecommendations.rank(collection, taste, recommendationBatches);
  const movies = ranked.map(movie => ({ ...fromTmdb(movie), recommendationReason: movie.recommendationReason }));
  syncCards(container, movies);
  renderRelatedPicks(taste);
  container.setAttribute('aria-busy', String(recommendationBusy));
  const refresh = $('refresh-recommendations');
  refresh.disabled = recommendationBusy;
  refresh.textContent = recommendationBusy ? 'Finding your next film…' : '↻ Refresh Recommendations';
  $('recommendation-taste').textContent = taste.likedCount ? `Inspired by ${taste.likedCount} personal taste signal(s)` : 'A fresh start for your next favorite';
  const signals = Store.feedback(collection);
  if ($('reset-recommendation-feedback')) $('reset-recommendation-feedback').disabled = !signals.dismissed.length && !signals.moreLike.length;
  if ($('feedback-summary')) $('feedback-summary').textContent = `${signals.dismissed.length} hidden · ${signals.moreLike.length} more-like-this signals`;
  const hasTaste = taste.seeds.length || taste.genres.length;
  const mood = taste.preferred.map(id => genreNames.get(id)).join(' / ');
  $('recommendation-message').textContent = recommendationBusy ? 'Exploring films connected to your taste…' : movies.length ? `${movies.length} films for you${mood ? ` · ${mood}` : ''}. Already watched films are excluded.` : hasTaste ? mood ? `No unseen matches for ${mood}. Try another genre or refresh.` : 'No unseen matches found in the available results. Try other genres or refresh.' : 'Rate a watched film 4–5 stars, choose a Top 4 favorite, or select a genre above to get started.';
  $('recommendation-error').textContent = recommendationError;
  if (!movies.length) container.append(element('p', 'empty-state', recommendationBusy ? 'Your next great film is on its way.' : !hasTaste ? 'Start with what you love. A few ratings or a favorite genre will help us find your next film.' : 'Broaden your taste with another genre, or add ratings to more watched films.'));
}
function render() {
  const query = $('movie-search')?.value.trim().toLowerCase() || '';
  const sort = $('movie-sort')?.value || 'saved';
  for (const list of ['watched', 'watchlist']) {
    const genre = $('movie-genre')?.value || '';
    const filtered = collection[list].filter(movie => movie.title.toLowerCase().includes(query) && matchesGenre(movie, genre));
    filtered.sort((a, b) => sort === 'title' ? a.title.localeCompare(b.title) : sort === 'rating-desc' ? b.rating - a.rating : sort === 'rating-asc' ? a.rating - b.rating : sort === 'year' ? Number(b.year) - Number(a.year) : 0);
    const container = $(list === 'watched' ? 'movie-container' : 'watchlist-container');
    if (container) {
    syncCards(container, filtered);
    if (!filtered.length) container.append(element('p', 'empty-state', query || genre ? 'No saved films match your filters. Films without genre information appear under All Genres.' : `No ${list === 'watched' ? 'watched films' : 'films on your watchlist'} yet. Visit Discover to find your next film.`));
    }
    if ($(`${list}-count`)) $(`${list}-count`).textContent = collection[list].length;
    if ($(`${list}-badge`)) $(`${list}-badge`).textContent = query || genre ? `${filtered.length} / ${collection[list].length}` : collection[list].length;
  }
  const summary = Store.statistics(collection);
  if ($('average-rating')) $('average-rating').textContent = summary.averageRating === null ? '—' : summary.averageRating.toFixed(1);
  renderStatistics(summary);
  renderRecommendations();
  renderCatalog();
  renderFavorites();
  renderPicker();
  if (activeMovie) updateControlsWithin($('detail-content'));
}
function catalogYearParameters() {
  const period = $('catalog-period')?.value || '';
  if (period === 'custom') return customYearRange || {};
  if (period === 'before1970') return { year_to: '1969' };
  return period ? { year_from: period, year_to: String(Number(period) + 9) } : {};
}
function catalogSort() {
  const select = $('catalog-sort');
  const value = select?.value;
  if (['popularity.desc', 'vote_average.desc', 'vote_count.desc'].includes(value)) return value;
  if (select) select.value = 'popularity.desc';
  return 'popularity.desc';
}
function updateCatalogFilterNote() {
  const ranked = mode === 'popular';
  if ($('catalog-sort')) $('catalog-sort').disabled = !ranked;
  if ($('catalog-filter-note')) $('catalog-filter-note').textContent = ranked ? (catalogSort() === 'vote_average.desc' ? 'Highly rated films across your selected period · at least 1,000 TMDB votes.' : 'Browse all eras with your selected genre, release period and sort order.') : 'Title search and Trending retain their TMDB order. Year and genre filters apply to every fetched page; Load more continues through the results.';
}
async function loadCatalog(reset = false) {
  if (reset) {
    controller?.abort();
    catalog = []; page = 0; totalPages = 0;
  } else if (busy) return;
  const current = ++requestId;
  controller = new AbortController();
  busy = true; failed = false;
  const nextPage = page + 1;
  const selectedGenre = $('catalog-genre')?.value || '';
  const years = catalogYearParameters();
  const browse = mode === 'popular' && !!$('catalog-sort');
  updateCatalogFilterNote();
  $('catalog-container').setAttribute('aria-busy', 'true');
  $('catalog-message').textContent = 'Loading films…';
  $('catalog-title').textContent = mode === 'search' ? `Results for “${searchQuery}”` : mode === 'trending' ? 'Trending this week' : browse ? 'Great films, every era' : 'Popular films';
  for (const category of ['popular', 'trending']) $(category).setAttribute('aria-pressed', String(mode === category));
  renderCatalog();
  try {
    const data = await api(browse ? 'discover' : mode, { page: String(nextPage), ...years, ...(browse ? { sort: catalogSort() } : {}), ...(selectedGenre ? { genre: selectedGenre } : {}), ...(mode === 'search' ? { query: searchQuery } : {}) }, controller.signal);
    if (current !== requestId) return;
    if (!Array.isArray(data.results)) throw Error('Unexpected catalog response. Please try again.');
    const seen = new Set(catalog.map(movie => movie.tmdbId));
    catalog.push(...data.results.filter(movie => !movie.adult && (!selectedGenre || (movie.genre_ids || movie.genres?.map(genre => genre.id) || []).includes(Number(selectedGenre))) && Number.isSafeInteger(movie.id) && !seen.has(movie.id) && seen.add(movie.id)).map(fromTmdb));
    page = nextPage;
    totalPages = Math.min(Number(data.total_pages) || 0, 500);
    $('catalog-message').textContent = catalog.length ? `${catalog.length} films shown. Open a film for its synopsis and genres.` : (selectedGenre || years.year_from || years.year_to) && page < totalPages ? 'No matching films on the pages loaded so far. Load more to continue with these filters.' : 'No films found. Try another title, genre or release period.';
  } catch (error) {
    if (current !== requestId || error.name === 'AbortError') return;
    failed = true;
    $('catalog-message').textContent = error.message || 'Could not connect. Please try again.';
  } finally {
    if (current === requestId) {
      busy = false;
      $('catalog-container').setAttribute('aria-busy', 'false');
      renderCatalog();
    }
  }
}
function finishLink() {
  linkingMovie = null;
  $('catalog-container').replaceChildren();
  if ($('movie-search')) $('discover').hidden = true;
  $('link-notice').hidden = true;
  $('cancel-link').hidden = true;
  renderCatalog();
}
function beginLink(movie) {
  if (!$('discover')) { window.location.href = 'watched.html'; return; }
  linkingMovie = movie;
  $('catalog-container').replaceChildren();
  $('discover').hidden = false;
  $('link-notice').hidden = false;
  $('link-notice').textContent = `Select “Link this film” on the correct TMDB result for your saved entry: ${movie.title} (${movie.year}). Its saved status and rating will be preserved.`;
  $('cancel-link').hidden = false;
  $('catalog-genre').value = '';
  $('catalog-query').value = movie.title.slice(0, 150);
  searchCatalog();
  $('discover').scrollIntoView({ behavior: 'smooth' });
}
function searchCatalog() {
  searchQuery = $('catalog-query').value.trim();
  mode = searchQuery ? 'search' : 'popular';
  loadCatalog(true);
}
let detailError = '';
function renderDetails() {
  if (!activeMovie) return;
  const movie = activeMovie;
  const content = $('detail-content');
  const layout = element('div', 'detail-layout');
  const body = element('div', 'detail-body');
  const title = element('h2', '', movie.title);
  title.id = 'detail-title';
  body.append(title, element('p', 'film-year', movie.year || 'Release date unknown'), element('p', 'genres', movie.genres.length ? movie.genres.join(' · ') : 'Genres not available'), element('p', 'synopsis', movie.overview || 'No synopsis available.'), controls(movie));
  if (detailError) {
    const message = element('p', 'detail-message', detailError);
    message.setAttribute('role', 'status');
    body.append(message);
    if (movie.tmdbId) body.append(button('Retry details', () => fetchDetails(movie)));
  }
  if (!movie.tmdbId) body.append(button('Find in TMDB', () => { $('movie-dialog').close(); beginLink(movie); }));
  layout.append(poster(movie, false), body);
  content.replaceChildren(layout);
}
async function fetchDetails(movie) {
  const current = ++detailRequest;
  detailError = 'Loading full movie details…';
  renderDetails();
  try {
    const data = detailCache.get(movie.tmdbId) || fromTmdb(await api('details', { id: String(movie.tmdbId) }));
    detailCache.set(movie.tmdbId, data);
    if (current !== detailRequest || !activeMovie) return;
    activeMovie = data;
    detailError = '';
    // Keep enriched metadata in already saved entries without changing rating or status.
    const saved = Store.find(collection, data);
    if (saved) {
      Object.assign(saved, data, { rating: saved.rating });
      persist(`Details loaded for ${data.title}.`);
    }
  } catch (error) {
    if (current !== detailRequest || !activeMovie) return;
    detailError = error.message || 'Full details unavailable. You can still manage this film.';
  }
  renderDetails();
}
function openDetails(movie) {
  activeMovie = movie;
  detailError = movie.tmdbId ? '' : 'This entry was saved before TMDB integration. Link it to a catalog film to add its real poster and details.';
  renderDetails();
  $('movie-dialog').showModal();
  if (movie.tmdbId) fetchDetails(movie);
}
function toggleFavorite(movie) {
  if (Store.status(collection, movie) !== 'watched') return;
  if (Store.toggleFavorite(collection, movie)) {
    persist(`${movie.title}: ${Store.isFavorite(collection, movie) ? 'added to' : 'removed from'} your Top 4.`, true);
    return;
  }
  pendingFavorite = movie;
  $('favorite-replace-message').textContent = `Choose a film to replace with ${movie.title}. Your existing ratings will be kept.`;
  $('favorite-replacements').replaceChildren(...Store.favorites(collection).map(previous => {
    const choice = button(`Replace ${previous.title}`, () => {
      const added = Store.replaceFavorite(collection, previous, pendingFavorite);
      $('favorite-dialog').close();
      persist(added ? `${movie.title} is now in your Top 4.` : 'Your favorites changed. Please choose again.', true);
    }, 'secondary-button');
    return choice;
  }));
  $('favorite-dialog').showModal();
}
function renderFavorites() {
  const container = $('favorites-container');
  if (!container) return;
  const movies = Store.favorites(collection);
  $('favorites-count').textContent = `${movies.length} / 4`;
  const previous = new Map([...container.children].map(node => [node.favoriteKey, node]));
  const nodes = Array.from({ length: 4 }, (_, index) => {
    const movie = movies[index];
    const key = movie ? Store.identity(movie) : 'empty:' + index;
    const signature = movie ? JSON.stringify({ ...movie, rating: 0 }) : key;
    let node = previous.get(key);
    if (!node || node.favoriteSignature !== signature) {
      node = element('article', movie ? 'favorite-film' : 'favorite-film favorite-empty');
      node.favoriteKey = key; node.favoriteSignature = signature;
      if (movie) {
        const open = button('', () => openDetails(Store.find(collection, movie) || movie), 'movie-open');
        open.setAttribute('aria-label', `View details for favorite ${movie.title}`);
        open.append(poster(movie));
        const body = element('div', 'favorite-body');
        node.rank = element('span', 'favorite-rank');
        const title = button(movie.title, () => openDetails(Store.find(collection, movie) || movie), 'title-button');
        const actions = element('div', 'favorite-order');
        const move = direction => {
          Store.moveFavorite(collection, movie, direction);
          persist(`Top 4 order updated for ${movie.title}.`, true);
        };
        node.earlier = button('←', () => move(-1));
        node.later = button('→', () => move(1));
        node.earlier.setAttribute('aria-label', `Move ${movie.title} earlier`);
        node.later.setAttribute('aria-label', `Move ${movie.title} later`);
        const remove = button('♥ Remove', () => toggleFavorite(movie), 'favorite-button');
        remove.setAttribute('aria-label', `Remove ${movie.title} from favorites`);
        actions.append(node.earlier, node.later, remove);
        body.append(node.rank, title, actions); node.append(open, body);
      } else {
        const empty = element('div', 'favorite-slot');
        empty.append(element('span', 'favorite-slot-heart', '♡'), element('p', '', `Your #${index + 1} favorite`));
        const hint = element('div', 'favorite-body', 'A film that stays with you.');
        node.append(empty, hint);
      }
    }
    if (movie) {
      node.rank.textContent = `0${index + 1} / YOUR TOP 4`;
      node.earlier.disabled = index === 0; node.later.disabled = index === movies.length - 1;
    }
    return node;
  });
  for (const child of [...container.children]) if (!nodes.includes(child)) child.remove();
  nodes.forEach((node, index) => { if (container.children[index] !== node) container.insertBefore(node, container.children[index] || null); });
}
function pickMovie() {
  pickerStarted = true;
  pickedMovie = Store.pickRandom(collection, pickedMovie);
  renderPicker();
  if (pickedMovie) announce(`Tonight’s pick: ${pickedMovie.title}.`);
}
function renderPicker() {
  const container = $('picker-poster');
  if (!container) return;
  // A selected film can be moved or removed in details, cards, or another tab.
  pickedMovie = pickedMovie && collection.watchlist.find(movie => Store.identity(movie) === Store.identity(pickedMovie)) || null;
  const movie = pickedMovie;
  const signature = movie ? JSON.stringify(movie) : 'empty';
  if (container.movieSignature !== signature) {
    container.movieSignature = signature;
    container.replaceChildren(movie ? poster(movie, false) : element('div', 'picker-placeholder', '✦'));
  }
  $('picker-message').textContent = !collection.watchlist.length ? 'Your watchlist is waiting for its first film. Add movies on Discover, then let us pick one.' : movie ? 'Tonight’s pick' : pickerStarted ? 'Ready for another? Pick your next film from the watchlist.' : 'Too many good choices? Let chance decide.';
  $('picker-title').textContent = movie?.title || 'Your next movie night starts here.';
  $('picker-year').textContent = movie ? movie.year || 'Release date unknown' : '';
  $('picker-overview').textContent = movie ? movie.overview || 'No description saved yet. Open movie details for more.' : 'Pick a film and let your watchlist surprise you.';
  $('picker-watched').disabled = !movie;
  $('picker-details').disabled = !movie;
  $('pick-another').disabled = !collection.watchlist.length || !pickerStarted;
}
$('pick-movie')?.addEventListener('click', pickMovie);
$('pick-another')?.addEventListener('click', pickMovie);
$('picker-details')?.addEventListener('click', () => { if (pickedMovie) openDetails(pickedMovie); });
$('picker-watched')?.addEventListener('click', () => { if (pickedMovie) changeStatus(pickedMovie, 'watched'); });
$('cancel-favorite').addEventListener('click', () => $('favorite-dialog').close());
$('favorite-dialog').addEventListener('close', () => { pendingFavorite = null; });
$('close-dialog').addEventListener('click', () => $('movie-dialog').close());
$('movie-dialog').addEventListener('close', () => { activeMovie = null; detailRequest++; });
$('catalog-search')?.addEventListener('submit', event => { event.preventDefault(); searchCatalog(); });
$('catalog-query')?.addEventListener('input', () => { if (!$('catalog-query').value.trim() && mode === 'search') searchCatalog(); });
for (const category of ['popular', 'trending']) $(category)?.addEventListener('click', () => { mode = category; searchQuery = ''; $('catalog-query').value = ''; loadCatalog(true); });
$('load-more')?.addEventListener('click', () => loadCatalog());
$('retry-catalog')?.addEventListener('click', () => loadCatalog());
$('cancel-link')?.addEventListener('click', finishLink);
function filterCollection() {
  for (const id of ['movie-container', 'watchlist-container']) if ($(id)) $(id).style.minHeight = '';
  render();
}
$('movie-search')?.addEventListener('input', filterCollection);
$('movie-sort')?.addEventListener('change', filterCollection);
$('movie-genre')?.addEventListener('change', filterCollection);
$('catalog-genre')?.addEventListener('change', () => loadCatalog(true));
$('catalog-sort')?.addEventListener('change', () => loadCatalog(true));
$('catalog-period')?.addEventListener('change', () => {
  const custom = $('catalog-period').value === 'custom';
  $('catalog-range').hidden = !custom;
  if (!custom || customYearRange) loadCatalog(true);
  else $('catalog-filter-note').textContent = 'Enter a start and end year, then apply. Use the same year for a specific release year.';
});
$('catalog-range')?.addEventListener('submit', event => {
  event.preventDefault();
  const from = $('catalog-year-from').value, to = $('catalog-year-to').value;
  if (![from, to].every(year => /^\d{4}$/.test(year) && Number(year) >= 1800 && Number(year) <= 2100) || Number(from) > Number(to)) {
    $('catalog-filter-note').textContent = 'Enter years from 1800 to 2100, with the start year no later than the end year.';
    return;
  }
  customYearRange = { year_from: from, year_to: to };
  loadCatalog(true);
});
$('refresh-recommendations')?.addEventListener('click', loadRecommendations);
$('reset-recommendation-feedback')?.addEventListener('click', resetRecommendationFeedback);
$('undo-action')?.addEventListener('click', undoLastAction);
$('dialog-undo')?.addEventListener('click', undoLastAction);
$('related-undo')?.addEventListener('click', undoLastAction);
$('close-related')?.addEventListener('click', () => $('related-dialog').close());
$('related-retry')?.addEventListener('click', loadRecommendations);
$('dismiss-undo')?.addEventListener('click', clearUndo);
updateUndoUI();
setupRecommendationPreferences();
render();
if ($('discover') && !$('discover').hidden) loadCatalog(true);
if ($('catalog-container')) api('genres').then(data => {
  if (!Array.isArray(data.genres) || !data.genres.length) return;
  genreNames = new Map(data.genres.map(genre => [genre.id, genre.name]));
  for (const id of ['catalog-genre', 'movie-genre']) {
    const select = $(id);
    if (!select) continue;
    const previous = select.value;
    select.replaceChildren();
    select.add(new Option('All Genres', ''));
    for (const [id, name] of genreNames) select.add(new Option(name, String(id)));
    select.value = genreNames.has(Number(previous)) ? previous : '';
  }
  render();
}).catch(() => { /* Details still provide genre names when the genre index is unavailable. */ });

// Other pages on this origin share the same collection; refresh open tabs and restored pages.
function refreshCollection() {
  clearUndo();
  try {
    collection = Store.load(localStorage);
    storageLocked = false;
    render();
  } catch {
    storageLocked = true;
    announce('Saved data could not be read. It has been left untouched. Reload after restoring storage.');
  }
}
window.addEventListener('storage', event => {
  if (event.key === Store.KEY || event.key === null || event.key === 'movielist-v1' || event.key === 'movies') refreshCollection();
});
window.addEventListener('pageshow', event => {
  if (event.persisted) refreshCollection();
  const sort = $('catalog-sort');
  if (sort && !['popularity.desc', 'vote_average.desc', 'vote_count.desc'].includes(sort.value)) {
    catalogSort();
    loadCatalog(true);
  }
});
