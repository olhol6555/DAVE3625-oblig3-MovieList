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
function announce(text) { $('status').textContent = text; }
let collection = { watched: [], watchlist: [] };
let storageLocked = false;
try { collection = Store.load(localStorage); }
catch {
  storageLocked = true;
  announce('Saved data could not be read. It has been left untouched. New changes are temporary until storage is available and the page is reloaded.');
}
function persist(message, interaction = false) {
  const x = window.scrollX, y = window.scrollY;
  const focused = document.activeElement;
  if (interaction) {
    for (const id of ['movie-container', 'watchlist-container']) {
      const grid = $(id);
      if (grid) grid.style.minHeight = Math.ceil(grid.getBoundingClientRect().height) + 'px';
    }
  }
  render();
  if (interaction) {
    if (focused?.isConnected && !focused.disabled && document.activeElement !== focused) focused.focus({ preventScroll: true });
    if (focused && (!focused.isConnected || focused.disabled)) {
      const target = $('movie-dialog').open ? $('close-dialog') : $('movie-search');
      target?.focus({ preventScroll: true });
    }
    window.scrollTo({ left: x, top: y, behavior: 'instant' });
  }
  if (storageLocked) { announce('Change shown for this session only. Existing unreadable storage was left untouched.'); return; }
  try { localStorage.setItem(Store.KEY, JSON.stringify(collection)); announce(message); }
  catch { announce('Change shown, but could not be saved. Browser storage may be disabled or full.'); }
}
// TMDB's movie genre taxonomy also keeps saved-film filters available offline.
let genreNames = new Map([[28,"Action"],[12,"Adventure"],[16,"Animation"],[35,"Comedy"],[80,"Crime"],[99,"Documentary"],[18,"Drama"],[10751,"Family"],[14,"Fantasy"],[36,"History"],[27,"Horror"],[10402,"Music"],[9648,"Mystery"],[10749,"Romance"],[878,"Science Fiction"],[10770,"TV Movie"],[53,"Thriller"],[10752,"War"],[37,"Western"]]);
function matchesGenre(movie, id) {
  if (!id) return true;
  const name = genreNames.get(Number(id));
  return (movie.genres || []).includes(name);
}
let catalog = [], mode = 'popular', searchQuery = '', page = 0, totalPages = 0;
let requestId = 0, controller, busy = false, failed = false;
let activeMovie = null, detailRequest = 0, linkingMovie = null;
let pickedMovie = null, pickerStarted = false, pendingFavorite = null;
const detailCache = new Map();
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
  Store.setStatus(collection, movie, next);
  persist(`${movie.title}: ${statusLabel[next]}.`, true);
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
    const label = element('span', 'status-label');
    control.textContent = '';
    control.append(icon, label);
    control.statusLabel = label;
    actions.append(control);
    return control;
  });
  const rating = element('div', 'star-rating');
  const caption = element('div', 'rating-caption');
  const valueLabel = element('span');
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
  const favorite = button('♡ Add to Favorites', () => toggleFavorite(movie), 'favorite-button');
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
    favorite.textContent = selected ? '♥ In Favorites' : '♡ Add to Favorites';
    favorite.setAttribute('aria-pressed', String(selected));
    favorite.setAttribute('aria-label', `${selected ? 'Remove' : 'Add'} ${movie.title} ${selected ? 'from' : 'to'} favorites`);
    // Reserve the same space in every card so status changes never resize rows.
    rating.style.visibility = state === 'watched' ? 'visible' : 'hidden';
    rating.inert = state !== 'watched';
    valueLabel.textContent = value ? `Your rating · ${value} / 5` : 'Your rating · optional';
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
  if (inCatalog && linkingMovie) body.append(button('Link this film', () => {
    Store.link(collection, linkingMovie, movie);
    finishLink();
    persist(`Saved film linked to ${movie.title}.`);
  }, 'button'));
  else body.append(controls(movie));
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
  const rated = collection.watched.filter(movie => movie.rating);
  $('average-rating').textContent = rated.length ? (rated.reduce((sum, movie) => sum + movie.rating, 0) / rated.length).toFixed(1) : '—';
  renderCatalog();
  renderFavorites();
  renderPicker();
  if (activeMovie) updateControlsWithin($('detail-content'));
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
  $('catalog-container').setAttribute('aria-busy', 'true');
  $('catalog-message').textContent = 'Loading films…';
  $('catalog-title').textContent = mode === 'search' ? `Results for “${searchQuery}”` : mode === 'trending' ? 'Trending this week' : 'Popular films';
  for (const category of ['popular', 'trending']) $(category).setAttribute('aria-pressed', String(mode === category));
  renderCatalog();
  try {
    const data = await api(mode, { page: String(nextPage), ...(selectedGenre ? { genre: selectedGenre } : {}), ...(mode === 'search' ? { query: searchQuery } : {}) }, controller.signal);
    if (current !== requestId) return;
    if (!Array.isArray(data.results)) throw Error('Unexpected catalog response. Please try again.');
    const seen = new Set(catalog.map(movie => movie.tmdbId));
    catalog.push(...data.results.filter(movie => !movie.adult && (!selectedGenre || (movie.genre_ids || movie.genres?.map(genre => genre.id) || []).includes(Number(selectedGenre))) && Number.isSafeInteger(movie.id) && !seen.has(movie.id) && seen.add(movie.id)).map(fromTmdb));
    page = nextPage;
    totalPages = Math.min(Number(data.total_pages) || 0, 500);
    $('catalog-message').textContent = catalog.length ? `${catalog.length} films shown. Open a film for its synopsis and genres.` : selectedGenre && page < totalPages ? 'No matching films on the pages loaded so far. Load more to continue browsing this genre.' : 'No films found. Try another title or genre.';
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
$('catalog-search').addEventListener('submit', event => { event.preventDefault(); searchCatalog(); });
$('catalog-query').addEventListener('input', () => { if (!$('catalog-query').value.trim() && mode === 'search') searchCatalog(); });
for (const category of ['popular', 'trending']) $(category).addEventListener('click', () => { mode = category; searchQuery = ''; $('catalog-query').value = ''; loadCatalog(true); });
$('load-more').addEventListener('click', () => loadCatalog());
$('retry-catalog').addEventListener('click', () => loadCatalog());
$('cancel-link').addEventListener('click', finishLink);
function filterCollection() {
  for (const id of ['movie-container', 'watchlist-container']) if ($(id)) $(id).style.minHeight = '';
  render();
}
$('movie-search')?.addEventListener('input', filterCollection);
$('movie-sort')?.addEventListener('change', filterCollection);
$('movie-genre')?.addEventListener('change', filterCollection);
$('catalog-genre')?.addEventListener('change', () => loadCatalog(true));
render();
if (!$('discover').hidden) loadCatalog(true);
api('genres').then(data => {
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
window.addEventListener('pageshow', event => { if (event.persisted) refreshCollection(); });
