const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.join(__dirname, '..');
class Element {
  constructor() { this.value = ''; this.children = []; this.listeners = {}; this.attributes = {}; this.hidden = false; this.files = []; this.style = {}; this.isConnected = true; }
  append(...children) { for (const child of children) { child.parentNode = this; this.children.push(child); } }
  insertBefore(node, before) { if (node.parentNode) node.remove(); const index = before ? this.children.indexOf(before) : this.children.length; this.children.splice(index, 0, node); node.parentNode = this; node.isConnected = true; }
  getBoundingClientRect() { return { height: 600 }; }
  focus(options) { this.focusOptions = options; }
  replaceChildren(...children) { for (const child of [...this.children]) child.remove(); this.append(...children); }
  add(child) { this.append(child); }
  setAttribute(key, value) { this.attributes[key] = value; }
  addEventListener(event, handler) { this.listeners[event] = handler; }
  showModal() { this.open = true; }
  close() { this.open = false; this.listeners.close?.(); }
  scrollIntoView() {}
  remove() { if (this.parentNode) this.parentNode.children = this.parentNode.children.filter(child => child !== this); this.parentNode = null; this.isConnected = false; }
}
const tick = () => new Promise(resolve => setImmediate(resolve));
function boot(fetch, page = 'index.html', saved = {}) {
  const html = fs.readFileSync(path.join(root, page), 'utf8');
  const dom = Object.fromEntries([...html.matchAll(/id="([^"]+)"/g)].map(match => [match[1], new Element()]));
  for (const match of html.matchAll(/<[^>]*id="([^"]+)"[^>]*\bhidden[^>]*>/g)) dom[match[1]].hidden = true;
  const events = {};
  const context = vm.createContext({
    document: { getElementById: id => dom[id], createElement: () => new Element() },
    Option: class { constructor(text, value) { this.text = text; this.value = value; } },
    localStorage: { getItem: key => saved[key] ?? null, setItem: (key, value) => { saved[key] = value; } },
    window: { scrollX: 0, scrollY: 500, scrollTo: options => { events.scroll = options; }, addEventListener: (name, handler) => { events[name] = handler; } },
    fetch, URLSearchParams, AbortController, console, setTimeout
  });
  for (const file of ['collection.js', ...(page === 'recommendations.html' ? ['recommendations.js'] : []), 'script.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
  return { dom, saved, events, run: code => vm.runInContext(code, context) };
}
const tmdbMovie = { id: 42, title: 'A real catalog film', release_date: '2024-02-01', poster_path: '/poster.jpg', overview: 'A synopsis.', genre_ids: [18] };
const response = (data, ok = true) => ({ ok, json: async () => data });
test('frontend catalog, detail controls, ratings, persistence and local filter work together', async () => {
  const app = boot(async url => {
    const action = new URL(url, 'http://localhost').searchParams.get('action');
    return response(action === 'genres' ? { genres: [{ id: 18, name: 'Drama' }] } : action === 'details' ? { ...tmdbMovie, genres: [{ id: 18, name: 'Drama' }] } : { results: [tmdbMovie], total_pages: 2 });
  });
  await tick();
  assert.equal(app.dom['watched-count'].textContent, 0);
  assert.equal(app.dom['catalog-container'].children.length, 1);
  assert.equal(app.dom['load-more'].hidden, false);
  app.run('openDetails(catalog[0])');
  await tick();
  assert.equal(app.dom['movie-dialog'].open, true);
  assert.equal(app.run('activeMovie.genres[0]'), 'Drama');
  app.run("changeStatus(activeMovie, 'watchlist')");
  assert.equal(app.run('collection.watchlist.length'), 1);
  app.run("changeStatus(activeMovie, 'watched')");
  assert.equal(app.run('collection.watchlist.length'), 0);
  const body = app.dom['detail-content'].children[0].children[1];
  const controls = body.children[4];
  const star = controls.children[1].children[1].children[3].children[2];
  star.listeners.click();
  assert.equal(JSON.parse(app.saved['movielist-v2']).watched[0].rating, 3.5);
  assert.equal(JSON.parse(app.saved['movielist-v2']).watched[0].poster_path, '/poster.jpg');
  const watched = boot(async () => response({ genres: [] }), 'watched.html', app.saved);
  assert.equal(watched.dom['movie-container'].children.length, 1);
  watched.dom['movie-search'].value = 'no match';
  watched.dom['movie-search'].listeners.input();
  assert.match(watched.dom['movie-container'].children[0].textContent, /No saved films/);
  app.run("changeStatus(activeMovie, 'neutral')");
  assert.equal(JSON.parse(app.saved['movielist-v2']).watched.length, 0);
});
test('older search responses cannot replace a newer query; repeated pages are deduplicated', async () => {
  const pending = new Map();
  const app = boot(url => {
    const params = new URL(url, 'http://localhost').searchParams;
    if (params.get('action') === 'genres') return Promise.resolve(response({ genres: [] }));
    if (params.get('action') !== 'search') return Promise.resolve(response({ results: [], total_pages: 0 }));
    return new Promise(resolve => pending.set(params.get('query'), resolve));
  });
  await tick();
  app.dom['catalog-query'].value = 'old'; app.run('searchCatalog()');
  app.dom['catalog-query'].value = 'new'; app.run('searchCatalog()');
  pending.get('new')(response({ results: [tmdbMovie], total_pages: 2 }));
  await tick();
  pending.get('old')(response({ results: [{ ...tmdbMovie, id: 99 }], total_pages: 1 }));
  await tick();
  assert.equal(app.run('catalog[0].tmdbId'), 42);
  const next = app.run('loadCatalog()');
  pending.get('new')(response({ results: [tmdbMovie], total_pages: 2 }));
  await next;
  assert.equal(app.run('catalog.length'), 1);
});
test('missing API configuration produces visible setup guidance and retry', async () => {
  const app = boot(async () => response({ error: 'Set TMDB_READ_TOKEN in .env. See README.' }, false));
  await tick();
  assert.match(app.dom['catalog-message'].textContent, /TMDB_READ_TOKEN/);
  assert.equal(app.dom['retry-catalog'].hidden, false);
  assert.equal(app.dom['load-more'].hidden, true);
});

test('all five pages have working navigation, isolated views and consistent active links', () => {
  for (const page of ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'recommendations.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
    for (const target of ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'recommendations.html']) {
      assert.ok(nav.includes('href="' + target + '"'));
    }
    assert.ok(nav.includes('href="' + page + '" aria-current="page"'));
    assert.equal((nav.match(/aria-current/g) || []).length, 1);
    assert.equal(html.includes('id="movie-container"'), page === 'watched.html');
    assert.equal(html.includes('id="watchlist-container"'), page === 'watchlist.html');
  }
});

test('saved pages support sorting, ratings, cross-page moves, reloads and storage events', async () => {
  const saved = { 'movielist-v2': JSON.stringify({ watched: [
    { ...tmdbMovie, tmdbId: 42, title: 'Zulu', year: '2024', rating: 2 },
    { ...tmdbMovie, id: 43, tmdbId: 43, title: 'Alpha', year: '2020', rating: 5 }
  ], watchlist: [] }) };
  const calls = [];
  const fetch = async url => { calls.push(url); return response({ genres: [] }); };
  const watched = boot(fetch, 'watched.html', saved);
  await tick();
  assert.ok(calls.every(url => url.includes('action=genres')));
  const titles = () => watched.dom['movie-container'].children.map(card => card.children[1].children[0].textContent);
  watched.dom['movie-sort'].value = 'title'; watched.dom['movie-sort'].listeners.change();
  assert.deepEqual(titles(), ['Alpha', 'Zulu']);
  watched.dom['movie-sort'].value = 'rating-desc'; watched.dom['movie-sort'].listeners.change();
  assert.deepEqual(titles(), ['Alpha', 'Zulu']);
  watched.dom['movie-sort'].value = 'rating-asc'; watched.dom['movie-sort'].listeners.change();
  assert.deepEqual(titles(), ['Zulu', 'Alpha']);
  const star = watched.dom['movie-container'].children[0].children[1].children[2].children[1].children[1].children[4].children[2];
  star.listeners.click();
  const reloaded = boot(fetch, 'watched.html', saved);
  assert.equal(reloaded.run('collection.watched[0].rating'), 4.5);
  watched.run("changeStatus(collection.watched[0], 'watchlist')");
  const watchlist = boot(fetch, 'watchlist.html', saved);
  assert.equal(watchlist.dom['watchlist-container'].children.length, 1);
  assert.equal(watchlist.run('collection.watchlist[0].rating'), 0);
  watchlist.dom['movie-search'].value = 'absent'; watchlist.dom['movie-search'].listeners.input();
  assert.match(watchlist.dom['watchlist-container'].children[0].textContent, /No saved films/);
  watchlist.run("changeStatus(collection.watchlist[0], 'watched')");
  reloaded.events.storage({ key: 'movielist-v2' });
  assert.equal(reloaded.run('collection.watched.length'), 2);
  assert.equal(reloaded.run('collection.watchlist.length'), 0);
  reloaded.run("changeStatus(collection.watched[0], 'neutral')");
  assert.equal(boot(fetch, 'watched.html', saved).run('collection.watched.length'), 1);
});

test('legacy linking is available on saved pages without losing personal ratings', async () => {
  const saved = { 'movielist-v1': JSON.stringify({ watched: [{ title: 'Old film', year: '2000', rating: 4 }], watchlist: [] }) };
  const original = saved['movielist-v1'];
  const app = boot(async url => response(url.includes('action=genres') ? { genres: [] } : { results: [tmdbMovie], total_pages: 1 }), 'watched.html', saved);
  app.run('beginLink(collection.watched[0])');
  await tick();
  assert.equal(app.dom.discover.hidden, false);
  app.run('Store.link(collection, linkingMovie, catalog[0]); finishLink(); persist("Linked");');
  assert.equal(app.run('collection.watched[0].rating'), 4);
  assert.equal(app.run('collection.watched[0].tmdbId'), 42);
  assert.equal(saved['movielist-v1'], original);
});

test('status toggles and half stars retain cards, controls, focus targets and open details', async () => {
  const app = boot(async url => response(url.includes('action=genres') ? { genres: [] } : url.includes('action=details') ? { ...tmdbMovie, genres: [] } : { results: [tmdbMovie], total_pages: 1 }));
  await tick();
  const card = app.dom['catalog-container'].children[0];
  const controls = card.children[1].children[2];
  const watched = controls.children[0].children[0], watchlist = controls.children[0].children[1];
  assert.equal(watched.type, 'button');
  watched.listeners.click();
  assert.equal(watched.attributes['aria-pressed'], 'true');
  assert.equal(app.dom['catalog-container'].children[0], card);
  assert.equal(card.children[1].children[2], controls);
  assert.equal(app.events.scroll.top, 500);
  app.run('openDetails(catalog[0])'); await tick();
  const layout = app.dom['detail-content'].children[0];
  const detailControls = layout.children[1].children[4];
  const rating = detailControls.children[1];
  const stars = rating.children[1];
  assert.equal(stars.attributes.role, 'radiogroup');
  for (let half = 1; half <= 10; half++) {
    const hit = stars.children[Math.floor((half - 1) / 2)].children[2 + (half - 1) % 2];
    hit.listeners.click();
    assert.equal(JSON.parse(app.saved['movielist-v2']).watched[0].rating, half / 2);
    assert.equal(hit.attributes['aria-checked'], 'true');
    assert.equal(hit.tabIndex, 0);
    assert.equal(app.dom['detail-content'].children[0], layout);
    assert.equal(app.dom['movie-dialog'].open, true);
  }
  const first = stars.children[0].children[2];
  first.listeners.pointerenter();
  assert.equal(stars.children[0].children[1].style.clipPath, 'inset(0 50% 0 0)');
  assert.equal(app.run('collection.watched[0].rating'), 5);
  stars.listeners.pointerleave();
  assert.equal(stars.children[0].children[1].style.clipPath, 'inset(0 0% 0 0)');
  let prevented = false;
  first.listeners.keydown({ key: 'ArrowRight', preventDefault() { prevented = true; } });
  assert.ok(prevented);
  assert.equal(app.run('collection.watched[0].rating'), 1);
  assert.equal(stars.children[0].children[3].focusOptions.preventScroll, true);
  rating.children[0].children[1].listeners.click();
  assert.equal(app.run('collection.watched[0].rating'), 0);
  assert.equal(first.tabIndex, 0);
  assert.equal(rating.children[0].children[1].disabled, true);
  watchlist.listeners.click();
  assert.equal(watchlist.attributes['aria-pressed'], 'true');
  assert.equal(watched.attributes['aria-pressed'], 'false');
  assert.equal(rating.inert, true);
  watchlist.listeners.click();
  assert.equal(app.run('collection.watchlist.length'), 0);
  assert.equal(watchlist.attributes['aria-pressed'], 'false');
});
test('genre filters combine with saved search and sorting on both collection pages', () => {
  const saved = { 'movielist-v2': JSON.stringify({ watched: [
    { id: 1, title: 'Alpha', genres: ['Drama', 'Comedy'], rating: 3 },
    { id: 2, title: 'Beta', genres: ['Drama'], rating: 5 },
    { id: 3, title: 'Unknown', genres: [], rating: 0 }
  ], watchlist: [{ id: 4, title: 'Later', genres: ['Drama', 'Thriller'] }] }) };
  const fetch = async () => response({ genres: [] });
  const app = boot(fetch, 'watched.html', saved);
  app.dom['movie-genre'].value = '18'; app.dom['movie-genre'].listeners.change();
  app.dom['movie-sort'].value = 'rating-desc'; app.dom['movie-sort'].listeners.change();
  const titles = () => app.dom['movie-container'].children.map(card => card.children[1]?.children[0].textContent);
  assert.deepEqual(titles(), ['Beta', 'Alpha']);
  app.dom['movie-search'].value = 'alpha'; app.dom['movie-search'].listeners.input();
  assert.deepEqual(titles(), ['Alpha']);
  app.dom['movie-genre'].value = '35'; app.dom['movie-genre'].listeners.change();
  assert.deepEqual(titles(), ['Alpha']);
  app.dom['movie-genre'].value = '27'; app.dom['movie-genre'].listeners.change();
  assert.match(app.dom['movie-container'].children[0].textContent, /No saved films/);
  app.dom['movie-search'].value = ''; app.dom['movie-genre'].value = ''; app.dom['movie-genre'].listeners.change();
  assert.equal(app.dom['movie-container'].children.length, 3);
  const later = boot(fetch, 'watchlist.html', saved);
  for (const genre of ['18', '53']) {
    later.dom['movie-genre'].value = genre; later.dom['movie-genre'].listeners.change();
    assert.equal(later.dom['watchlist-container'].children[0].children[1].children[0].textContent, 'Later');
  }
  assert.equal(JSON.parse(saved['movielist-v2']).watched.length, 3);
});

test('Discover genre resets pagination, filters search/trending pages and permits empty-page continuation', async () => {
  const calls = [];
  const app = boot(async url => {
    const params = new URL(url, 'http://localhost').searchParams;
    calls.push(params);
    if (params.get('action') === 'genres') return response({ genres: [] });
    return response({ results: Number(params.get('page')) === 2 ? [tmdbMovie] : [{ ...tmdbMovie, id: 99, genre_ids: [35] }], total_pages: 2 });
  });
  await tick();
  app.dom['catalog-genre'].value = '18'; app.dom['catalog-genre'].listeners.change(); await tick();
  assert.equal(calls.at(-1).get('genre'), '18');
  assert.equal(calls.at(-1).get('page'), '1');
  assert.equal(app.dom['catalog-container'].children.length, 0);
  assert.equal(app.dom['load-more'].hidden, false);
  await app.run('loadCatalog()');
  assert.equal(app.run('catalog[0].tmdbId'), 42);
  assert.equal(app.dom['load-more'].hidden, true);
  app.dom['catalog-query'].value = 'film'; app.run('searchCatalog()'); await tick();
  assert.equal(calls.at(-1).get('action'), 'search');
  assert.equal(calls.at(-1).get('query'), 'film');
  assert.equal(calls.at(-1).get('genre'), '18');
  app.dom.trending.listeners.click(); await tick();
  assert.equal(calls.at(-1).get('action'), 'trending');
  assert.equal(calls.at(-1).get('genre'), '18');
  app.dom['catalog-genre'].value = ''; app.dom['catalog-genre'].listeners.change(); await tick();
  assert.equal(calls.at(-1).get('genre'), null);
  assert.equal(app.run('catalog.length'), 1);
});

test('export UI is removed and status labels switch without replacing buttons', async () => {
  for (const page of ['index.html', 'watched.html', 'watchlist.html', 'stats.html', 'recommendations.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(!html.includes('export-collection'));
    assert.ok(!html.includes('backup-controls'));
    if (!['stats.html', 'recommendations.html'].includes(page)) {
      assert.ok(html.includes('All Genres'));
      assert.ok(html.includes('Science Fiction'));
    }
  }
  const app = boot(async url => response(url.includes('action=genres') ? { genres: [] } : { results: [tmdbMovie], total_pages: 1 })); await tick();
  const controls = app.dom['catalog-container'].children[0].children[1].children[2];
  const watched = controls.children[0].children[0], watchlist = controls.children[0].children[1];
  assert.equal(watchlist.statusLabel.textContent, 'Watchlist');
  watchlist.listeners.click();
  assert.equal(watchlist.statusLabel.textContent, 'In Watchlist');
  watched.listeners.click();
  assert.equal(watched.statusLabel.textContent, 'Watched');
  assert.equal(watchlist.statusLabel.textContent, 'Watchlist');
  assert.equal(watchlist.attributes['aria-pressed'], 'false');
  watched.listeners.click();
  assert.equal(watched.attributes['aria-pressed'], 'false');
  assert.equal(app.run('collection.watched.length + collection.watchlist.length'), 0);
});

test('Top 4 UI adds, replaces, reorders, opens details and persists without changing ratings', async () => {
  const saved = { 'movielist-v2': JSON.stringify({ watched: Array.from({length:5}, (_, i) => ({ id:i+1, title:`Film ${i+1}`, poster_path:'/poster.jpg', year:'2020', rating:4, genres:['Drama'] })), watchlist:[] }) };
  const app = boot(async url => response(url.includes('action=genres') ? { genres:[] } : { ...tmdbMovie, id:1, genres:[] }), 'watched.html', saved);
  const cards = app.dom['movie-container'].children;
  const heart = card => card.children[1].children[2].children[2];
  assert.equal(app.dom['favorites-container'].children.length, 4);
  assert.equal(app.run('Store.favorites(collection).length'), 0);
  const button = heart(cards[0]); button.listeners.click();
  assert.equal(button.attributes['aria-pressed'], 'true');
  assert.equal(app.dom['movie-container'].children[0], cards[0]);
  for (const card of cards.slice(1,4)) heart(card).listeners.click();
  heart(cards[4]).listeners.click();
  assert.equal(app.dom['favorite-dialog'].open, true);
  app.dom['favorite-replacements'].children[0].listeners.click();
  assert.equal(app.dom['favorite-dialog'].open, false);
  assert.equal(app.run('Store.favorites(collection)[0].tmdbId'), 5);
  const second = app.dom['favorites-container'].children[1];
  second.earlier.listeners.click();
  assert.equal(app.dom['favorites-container'].children[0], second);
  assert.equal(app.events.scroll.top, 500);
  assert.equal(app.run('Store.favorites(collection)[0].tmdbId'), 2);
  const reloaded = boot(async () => response({genres:[]}), 'watched.html', saved);
  assert.equal(reloaded.run('Store.favorites(collection)[0].tmdbId'), 2);
  assert.equal(reloaded.run('collection.watched[0].rating'), 4);
  app.dom['favorites-container'].children[0].children[0].listeners.click();
  assert.equal(app.dom['movie-dialog'].open, true);
  assert.equal(app.run('activeMovie.tmdbId'), 2);
  app.run("changeStatus(Store.favorites(collection)[0], 'watchlist')");
  assert.equal(app.run('Store.favorites(collection).length'), 3);
  reloaded.events.storage({ key:'movielist-v2' });
  assert.equal(reloaded.run('Store.favorites(collection).length'), 3);
  await tick();
});

test('random picker displays saved posters/details, avoids repeats and marks picked films Watched', async () => {
  const saved = { 'movielist-v2': JSON.stringify({ watched:[], watchlist:[
    { id:1, title:'First pick', year:'2020', poster_path:'/first.jpg', overview:'First synopsis', genres:['Drama'] },
    { id:2, title:'Second pick', year:'2021', poster_path:'/second.jpg', overview:'Second synopsis', genres:['Comedy'] }
  ] }) };
  const calls = [];
  const app = boot(async url => { calls.push(url); return response({genres:[]}); }, 'watchlist.html', saved);
  await tick();
  app.dom['movie-search'].value = 'absent'; app.dom['movie-search'].listeners.input();
  app.dom['pick-movie'].listeners.click();
  const first = app.run('pickedMovie.tmdbId');
  assert.ok([1,2].includes(first));
  assert.ok(app.dom['picker-poster'].children[0].children[1].src.includes('image.tmdb.org'));
  assert.ok(app.dom['picker-overview'].textContent.includes('synopsis'));
  app.dom['pick-another'].listeners.click();
  assert.notEqual(app.run('pickedMovie.tmdbId'), first);
  assert.equal(app.dom['picker-watched'].disabled, false);
  assert.equal(calls.length, 1); // Only the existing genre request, no picker API.
  app.dom['picker-watched'].listeners.click();
  assert.equal(JSON.parse(saved['movielist-v2']).watched.length, 1);
  assert.equal(JSON.parse(saved['movielist-v2']).watchlist.length, 1);
  assert.equal(app.dom['picker-watched'].disabled, true);
  app.dom['pick-another'].listeners.click();
  assert.equal(app.run('pickedMovie.tmdbId'), first);
  app.dom['picker-watched'].listeners.click();
  assert.equal(app.run('collection.watchlist.length'), 0);
  assert.match(app.dom['picker-message'].textContent, /Add movies on Discover/);
  app.dom['pick-movie'].listeners.click();
  assert.equal(app.run('pickedMovie'), null);
  assert.equal(app.dom['pick-another'].disabled, true);
  assert.equal(app.dom['picker-details'].disabled, true);
});

test('all pages initialize without transfer controls and preserve existing stored collections', async () => {
  const original = JSON.stringify({
    watched: [{id:1,tmdbId:1,title:'Existing',year:'2020',poster_path:'/poster.jpg',overview:'Synopsis',genres:['Drama'],rating:4.5}],
    watchlist: [{id:2,tmdbId:2,title:'Later',year:'2021',genres:['Comedy'],rating:0}],
    favorites: ['tmdb:1']
  });
  const saved = { 'movielist-v2': original, 'movielist-v1': 'older backup' };
  for (const page of ['index.html','watched.html','watchlist.html','stats.html','recommendations.html']) {
    const app = boot(async url => response(url.includes('action=genres') ? {genres:[]} : {results:[],total_pages:0}), page, saved);
    await tick();
    assert.equal(app.run('collection.watched[0].rating'), 4.5);
    assert.equal(app.run('collection.watchlist[0].title'), 'Later');
    assert.equal(app.run('Store.favorites(collection)[0].title'), 'Existing');
    app.events.pageshow({persisted:true});
    assert.equal(saved['movielist-v2'], original);
    assert.equal(saved['movielist-v1'], 'older backup');
    assert.equal(app.dom['import-collection'], undefined);
    assert.equal(app.dom['export-collection'], undefined);
  }
});

test('picker details reuse existing dialog and synchronize status changes from another tab', async () => {
  const saved = { 'movielist-v2': JSON.stringify({ watched:[],watchlist:[{id:42,title:'A real catalog film',year:'2024',poster_path:'/poster.jpg',genres:[]}] }) };
  const app = boot(async url => response(url.includes('action=details') ? { ...tmdbMovie, genres:[{id:18,name:'Drama'}] } : {genres:[]}), 'watchlist.html', saved);
  app.dom['pick-movie'].listeners.click();
  app.dom['picker-details'].listeners.click();
  await tick();
  assert.equal(app.dom['movie-dialog'].open, true);
  assert.equal(app.dom['picker-overview'].textContent, 'A synopsis.');
  const other = boot(async () => response({genres:[]}), 'watchlist.html', saved);
  other.run("changeStatus(collection.watchlist[0], 'watched')");
  app.events.storage({key:'movielist-v2'});
  assert.equal(app.run('pickedMovie'), null);
  assert.equal(app.dom['picker-watched'].disabled, true);
  assert.equal(app.dom['movie-dialog'].open, true);
  assert.equal(app.run('collection.watched[0].rating'), 0);
});

test('Stats initializes offline with accessible empty states and no catalog DOM or writes', async () => {
  let calls = 0;
  const saved = {};
  const app = boot(async () => { calls++; throw Error('offline'); }, 'stats.html', saved);
  await tick();
  assert.equal(calls, 0);
  assert.equal(app.dom['watched-count'].textContent, 0);
  assert.equal(app.dom['rated-count'].textContent, 0);
  assert.equal(app.dom['average-rating'].textContent, '—');
  assert.match(app.dom['genre-chart'].children[0].textContent, /Mark a movie as watched/);
  assert.match(app.dom['rating-chart'].children[0].textContent, /No ratings yet/);
  assert.match(app.dom['highest-rated'].children[0].textContent, /Rate a watched film/);
  assert.deepEqual(saved, {});
  const html = fs.readFileSync(path.join(root, 'stats.html'), 'utf8');
  assert.match(html, /id="stats-update"[^>]*aria-live="polite"/);
});

test('Stats renders real collection charts and updates ratings/moves across tabs and restored pages', async () => {
  const original = JSON.stringify({watched:[
    {id:42,title:'Drama film',genres:['Drama','Comedy'],rating:4.5,year:'1999',poster_path:'/poster.jpg'},
    {id:43,title:'Unrated film',genres:['Drama'],rating:0,year:'2001'},
    {id:44,title:'Another film',genres:[],rating:2.5,year:''}
  ],watchlist:[{id:45,title:'Future watch',genres:['Action']}],favorites:['tmdb:42']});
  const saved = {'movielist-v2':original};
  const app = boot(async url => response(url.includes('action=details') ? {...tmdbMovie,genres:[{id:18,name:'Drama'},{id:35,name:'Comedy'}]} : {genres:[]}), 'stats.html', saved);
  assert.equal(saved['movielist-v2'], original);
  assert.equal(app.dom['watched-count'].textContent, 3);
  assert.equal(app.dom['watchlist-count'].textContent, 1);
  assert.equal(app.dom['rated-count'].textContent, 2);
  assert.equal(app.dom['average-rating'].textContent, '3.5');
  const genres = app.dom['genre-chart'].children[0].children;
  assert.equal(genres[0].children[0].textContent, 'Drama');
  assert.equal(genres[0].children[2].textContent, '2');
  assert.equal(genres[0].children[1].attributes['aria-hidden'], 'true');
  assert.equal(app.dom['rating-chart'].children[0].children.length, 10);
  assert.match(app.dom['genre-note'].textContent, /1 watched film/);
  const card = app.dom['highest-rated'].children[0];
  assert.equal(card.children[1].children[0].textContent, 'Drama film');
  assert.equal(card.children[1].children[2].textContent, '★ 4.5 / 5');
  card.children[0].listeners.click(); await tick();
  app.run('changeRating(activeMovie, 5)');
  assert.equal(app.dom['movie-dialog'].open, true);
  assert.equal(app.dom['average-rating'].textContent, '3.8');
  const other = boot(async () => response({genres:[]}), 'watched.html', saved);
  other.run("changeStatus(collection.watched[0], 'watchlist')");
  app.events.storage({key:'movielist-v2'});
  assert.equal(app.dom['watched-count'].textContent, 2);
  assert.equal(app.dom['watchlist-count'].textContent, 2);
  assert.equal(app.dom['rated-count'].textContent, 1);
  assert.equal(app.dom['average-rating'].textContent, '2.5');
  saved['movielist-v2'] = JSON.stringify({watched:[],watchlist:[],favorites:[]});
  app.events.pageshow({persisted:true});
  assert.equal(app.dom['average-rating'].textContent, '—');
  assert.match(app.dom['rating-chart'].children[0].textContent, /No ratings yet/);
});

test('For You onboarding, optional genres, movie controls and watched exclusion preserve saved data', async () => {
  const calls = [];
  const saved = {};
  const app = boot(async url => { calls.push(url); return response({results:[{...tmdbMovie,genre_ids:[28]}, {...tmdbMovie,genre_ids:[28]}],total_pages:1}); }, 'recommendations.html', saved);
  await tick();
  assert.equal(calls.length,0);
  assert.match(app.dom['recommendation-message'].textContent,/get started/);
  assert.deepEqual(saved,{});
  const genre = app.dom['preference-options'].children[0];
  genre.listeners.click(); await tick();
  assert.equal(genre.attributes['aria-pressed'],'true');
  assert.equal(new URL(calls[0],'http://localhost').searchParams.get('action'),'discover');
  assert.equal(app.dom['recommendation-container'].children.length,1);
  const card = app.dom['recommendation-container'].children[0];
  assert.match(card.children[1].children[2].textContent,/interest in Action/);
  assert.equal(card.children[1].children[3].textContent,'A synopsis.');
  const controls = card.children[1].children[4];
  controls.children[0].children[1].listeners.click();
  assert.equal(JSON.parse(saved['movielist-v2']).watchlist[0].tmdbId,42);
  assert.equal(app.dom['recommendation-container'].children[0],card);
  controls.children[0].children[0].listeners.click();
  await tick();
  assert.equal(JSON.parse(saved['movielist-v2']).watched[0].tmdbId,42);
  assert.equal(app.dom['recommendation-container'].children[0].className,'empty-state');
  assert.equal(app.events.scroll.top,500);
  app.dom['refresh-recommendations'].listeners.click(); await tick();
  assert.equal(app.dom['recommendation-container'].children[0].className,'empty-state');
});

test('For You combines personalized sources, keeps partial results and supports retry', async () => {
  const saved = {'movielist-v2':JSON.stringify({watched:[{id:1,title:'Favorite film',genres:['Drama'],rating:5}],watchlist:[],favorites:['tmdb:1']})};
  const original=saved['movielist-v2'];
  let fail = true;
  const app=boot(async url=> {
    const action=new URL(url,'http://localhost').searchParams.get('action');
    if (action==='similar' && fail) return response({error:'Unavailable'},false);
    return response({results:[{...tmdbMovie,id:1},{...tmdbMovie,id:42}],total_pages:1});
  },'recommendations.html',saved);
  await tick();
  assert.equal(saved['movielist-v2'],original);
  assert.equal(app.dom['recommendation-container'].children.length,1);
  assert.match(app.dom['recommendation-error'].textContent,/Some movie sources/);
  assert.match(app.dom['recommendation-container'].children[0].children[1].children[2].textContent,/Top 4/);
  fail=false;
  app.dom['refresh-recommendations'].listeners.click(); await tick();
  assert.equal(app.dom['recommendation-error'].textContent,'');
  const other=boot(async()=>response({genres:[]}),'watched.html',saved);
  other.run("changeStatus({id:42,tmdbId:42,title:'A real catalog film',rating:0,genres:[]}, 'watched')");
  app.events.storage({key:'movielist-v2'}); await tick();
  assert.equal(app.dom['recommendation-container'].children[0].className,'empty-state');
});

test('For You ignores outdated responses after changing preferences', async () => {
  const pending=new Map();
  const app=boot(url=>{
    const genre=new URL(url,'http://localhost').searchParams.get('genre');
    return new Promise(resolve=>pending.set(genre,resolve));
  },'recommendations.html');
  const action=app.dom['preference-options'].children[0];
  const adventure=app.dom['preference-options'].children[1];
  action.listeners.click();
  action.listeners.click(); // Cancel action and return to onboarding.
  adventure.listeners.click();
  pending.get('12')(response({results:[{...tmdbMovie,id:12,genre_ids:[12]}]}));
  await tick();
  assert.equal(app.dom['recommendation-container'].children[0].movieKey,'tmdb:12');
  pending.get('28')(response({results:[{...tmdbMovie,id:28,genre_ids:[28]}]}));
  await tick();
  assert.equal(app.dom['recommendation-container'].children[0].movieKey,'tmdb:12');
});

test('For You displays a recoverable error when every source fails', async () => {
  const app=boot(async()=>response({error:'Unavailable'},false),'recommendations.html');
  app.dom['preference-options'].children[0].listeners.click(); await tick();
  assert.match(app.dom['recommendation-error'].textContent,/TMDB setup/);
  assert.equal(app.dom['refresh-recommendations'].disabled,false);
  assert.equal(app.dom['recommendation-container'].attributes['aria-busy'],'false');
});

test('Set the mood changes a strongly personalized feed and clearing it restores excluded genres', async()=>{
 const saved={'movielist-v2':JSON.stringify({watched:[{id:1,title:'Favorite drama',genres:['Drama'],rating:5}],watchlist:[],favorites:['tmdb:1']})};
 const calls=[];
 const app=boot(async url=>{
   const params=new URL(url,'http://localhost').searchParams;calls.push(params);
   return response({results:[{...tmdbMovie,id:101,genre_ids:[18]},{...tmdbMovie,id:102,genre_ids:[27]}]});
 },'recommendations.html',saved);
 await tick();
 const ids=()=>app.dom['recommendation-container'].children.map(card=>card.movieKey);
 assert.ok(ids().includes('tmdb:101'));
 const horror=app.dom['preference-options'].children.find(choice=>choice.genreId===27);
 horror.listeners.click();await tick();
 assert.deepEqual(ids(),['tmdb:102']);
 assert.ok(calls.some(params=>params.get('action')==='discover'&&params.get('genre')==='27'));
 assert.match(app.dom['recommendation-message'].textContent,/Horror/);
 horror.listeners.click();await tick();
 assert.ok(ids().includes('tmdb:101'));
 assert.ok(ids().includes('tmdb:102'));
 assert.equal(JSON.parse(saved['movielist-v2']).watched.length,1);
});

test('Discover defaults to established all-era films and combines period, genre, sorting and Load More',async()=>{
 const calls=[];
 const app=boot(async url=>{const params=new URL(url,'http://localhost').searchParams;calls.push(params);return response(params.get('action')==='genres'?{genres:[]}:{results:[tmdbMovie],total_pages:3});});
 await tick();
 const catalogCalls=()=>calls.filter(params=>params.get('action')!=='genres');
 assert.equal(catalogCalls()[0].get('action'),'discover');
 assert.equal(catalogCalls()[0].get('sort'),'popularity.desc');
 assert.equal(catalogCalls()[0].get('year_from'),null);
 app.dom['catalog-period'].value='1980';app.dom['catalog-period'].listeners.change();await tick();
 app.dom['catalog-genre'].value='18';app.dom['catalog-genre'].listeners.change();await tick();
 app.dom['catalog-sort'].value='vote_count.desc';app.dom['catalog-sort'].listeners.change();await tick();
 assert.equal(calls.at(-1).get('year_from'),'1980');
 assert.equal(calls.at(-1).get('year_to'),'1989');
 assert.equal(calls.at(-1).get('genre'),'18');
 assert.equal(calls.at(-1).get('sort'),'vote_count.desc');
 assert.equal(calls.at(-1).get('page'),'1');
 await app.run('loadCatalog()');
 assert.equal(calls.at(-1).get('page'),'2');
 assert.equal(calls.at(-1).get('year_from'),'1980');
 assert.equal(app.run('catalog.length'),1);
 app.dom['catalog-period'].value='before1970';app.dom['catalog-period'].listeners.change();await tick();
 assert.equal(calls.at(-1).get('page'),'1');
 assert.equal(calls.at(-1).get('year_from'),null);
 assert.equal(calls.at(-1).get('year_to'),'1969');
 for(const decade of ['1970','1990','2000','2010','2020']) {
  app.dom['catalog-period'].value=decade;app.dom['catalog-period'].listeners.change();await tick();
  assert.equal(calls.at(-1).get('year_to'),String(Number(decade)+9));
 }
 app.dom['catalog-query'].value='Film';app.run('searchCatalog()');await tick();
 assert.equal(calls.at(-1).get('action'),'search');
 assert.equal(calls.at(-1).get('query'),'Film');
 assert.equal(calls.at(-1).get('year_from'),'2020');
 assert.equal(calls.at(-1).get('sort'),null);
 assert.equal(app.dom['catalog-sort'].disabled,true);
 app.dom.popular.listeners.click();await tick();
 assert.equal(app.dom['catalog-sort'].disabled,false);
 assert.equal(calls.at(-1).get('sort'),'vote_count.desc');
});

test('custom year ranges support single years, validate ordering and reset pagination',async()=>{
 const calls=[];
 const app=boot(async url=>{calls.push(new URL(url,'http://localhost').searchParams);return response({results:[],total_pages:0});});await tick();
 app.dom['catalog-period'].value='custom';app.dom['catalog-period'].listeners.change();
 assert.equal(app.dom['catalog-range'].hidden,false);
 const before=calls.length;
 app.dom['catalog-year-from'].value='2000';app.dom['catalog-year-to'].value='1990';
 app.dom['catalog-range'].listeners.submit({preventDefault(){}});
 assert.equal(calls.length,before);
 assert.match(app.dom['catalog-filter-note'].textContent,/start year/);
 app.dom['catalog-year-from'].value='1968';app.dom['catalog-year-to'].value='1968';
 app.dom['catalog-range'].listeners.submit({preventDefault(){}});await tick();
 assert.equal(calls.at(-1).get('year_from'),'1968');
 assert.equal(calls.at(-1).get('year_to'),'1968');
 assert.equal(calls.at(-1).get('page'),'1');
 assert.match(app.dom['catalog-message'].textContent,/No films found/);
 app.dom['catalog-period'].value='';app.dom['catalog-period'].listeners.change();await tick();
 assert.equal(app.dom['catalog-range'].hidden,true);
 assert.equal(calls.at(-1).get('year_from'),null);
});

test('stale decade responses cannot overwrite newer combined filters',async()=>{
 const pending=new Map();
 const app=boot(url=>{const params=new URL(url,'http://localhost').searchParams;if(params.get('action')==='genres'||!params.get('year_from'))return Promise.resolve(response({results:[],genres:[],total_pages:0}));return new Promise(resolve=>pending.set(params.get('year_from'),resolve));});await tick();
 app.dom['catalog-period'].value='1980';app.dom['catalog-period'].listeners.change();
 app.dom['catalog-period'].value='1990';app.dom['catalog-period'].listeners.change();
 pending.get('1990')(response({results:[{...tmdbMovie,id:90}],total_pages:1}));await tick();
 pending.get('1980')(response({results:[{...tmdbMovie,id:80}],total_pages:1}));await tick();
 assert.equal(app.run('catalog[0].tmdbId'),90);
 assert.equal(app.dom['load-more'].hidden,true);
});

test('card control slots retain every label variant across status, favorite and rating changes', async()=>{
 const app=boot(async url=>response(url.includes('action=genres')?{genres:[]}:{results:[tmdbMovie],total_pages:1}));await tick();
 const card=app.dom['catalog-container'].children[0];
 const controls=card.children[1].children[2];
 const watched=controls.children[0].children[0], watchlist=controls.children[0].children[1];
 const rating=controls.children[1], favorite=controls.children[2];
 const ratingLabel=rating.children[0].children[0], favoriteLabel=favorite.children[0];
 const reserveTexts=label=>label.children.slice(1).map(node=>node.textContent);
 assert.deepEqual(reserveTexts(watchlist.children[1]),['Watchlist','In Watchlist']);
 assert.deepEqual(reserveTexts(favoriteLabel),['♡ Add to Favorites','♥ In Favorites']);
 assert.equal(reserveTexts(ratingLabel).length,11);
 const children=[...controls.children];
 const reserves=reserveTexts(ratingLabel);
 watched.listeners.click();favorite.listeners.click();
 app.run('changeRating(catalog[0], 0.5)');
 assert.equal(ratingLabel.valueNode.textContent,'Your rating · 0.5 / 5');
 assert.equal(favoriteLabel.valueNode.textContent,'♥ In Favorites');
 watchlist.listeners.click();
 assert.equal(favoriteLabel.valueNode.textContent,'♡ Add to Favorites');
 assert.equal(rating.style.visibility,'hidden');
 assert.equal(favorite.style.visibility,'hidden');
 assert.equal(rating.inert,true);
 assert.deepEqual(controls.children,children);
 assert.deepEqual(reserveTexts(ratingLabel),reserves);
 assert.equal(app.dom['catalog-container'].children[0],card);
 for(const label of [watchlist.children[1],favoriteLabel,ratingLabel])for(const reserve of label.children.slice(1))assert.equal(reserve.attributes['aria-hidden'],'true');
});

test('Discover offers only three sorts and obsolete selections fall back safely with filters intact',async()=>{
 const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
 const dropdown=html.match(/<select id="catalog-sort">([\s\S]*?)<\/select>/)[1];
 assert.equal((dropdown.match(/<option/g)||[]).length,3);
 assert.match(dropdown,/<option value="popularity.desc" selected>Most Popular<\/option>/);
 assert.ok(!dropdown.includes('primary_release_date'));
 const calls=[];
 const app=boot(async url=>{calls.push(new URL(url,'http://localhost').searchParams);return response({results:[],genres:[],total_pages:0});});await tick();
 app.dom['catalog-period'].value='1980';app.dom['catalog-genre'].value='18';
 for(const value of ['primary_release_date.desc','primary_release_date.asc','invalid','']) {
  app.dom['catalog-sort'].value=value;
  app.dom['catalog-sort'].listeners.change();await tick();
  assert.equal(app.dom['catalog-sort'].value,'popularity.desc');
  assert.equal(calls.at(-1).get('sort'),'popularity.desc');
  assert.equal(calls.at(-1).get('genre'),'18');
  assert.equal(calls.at(-1).get('year_from'),'1980');
  assert.equal(calls.at(-1).get('year_to'),'1989');
 }
 app.dom['catalog-sort'].value='primary_release_date.desc';
 app.events.pageshow({persisted:true});await tick();
 assert.equal(app.dom['catalog-sort'].value,'popularity.desc');
 assert.equal(calls.at(-1).get('sort'),'popularity.desc');
 for(const sort of ['vote_average.desc','vote_count.desc']) {
  app.dom['catalog-sort'].value=sort;app.dom['catalog-sort'].listeners.change();await tick();
  assert.equal(calls.at(-1).get('sort'),sort);
  assert.equal(calls.at(-1).get('year_from'),'1980');
 }
});

test('Undo restores watched status, rating and Top 4 from notification and open details',async()=>{
 const saved={'movielist-v2':JSON.stringify({watched:[{id:42,title:'A real catalog film',year:'2024',rating:4.5,genres:['Drama']}],watchlist:[],favorites:['tmdb:42']})};
 const app=boot(async url=>response(url.includes('action=details')?{...tmdbMovie,genres:[{id:18,name:'Drama'}]}:{genres:[]}),'watched.html',saved);
 app.run("changeStatus(collection.watched[0], 'watchlist')");
 assert.equal(app.dom['undo-toast'].hidden,false);
 assert.match(app.dom['undo-message'].textContent,/Watchlist/);
 assert.equal(app.run('collection.favorites.length'),0);
 app.dom['undo-action'].listeners.click();
 assert.equal(app.run('collection.watched[0].rating'),4.5);
 assert.equal(app.run('collection.favorites[0]'),'tmdb:42');
 assert.equal(app.dom['undo-toast'].hidden,true);
 app.run('openDetails(collection.watched[0])');await tick();
 app.run("changeStatus(activeMovie, 'neutral')");
 assert.equal(app.dom['dialog-undo'].disabled,false);
 app.dom['dialog-undo'].listeners.click();
 assert.equal(app.dom['movie-dialog'].open,true);
 assert.equal(app.run('collection.watched[0].rating'),4.5);
 assert.equal(JSON.parse(saved['movielist-v2']).favorites[0],'tmdb:42');
});

test('Undo restores a Random Picker move and external updates invalidate stale Undo',async()=>{
 const saved={'movielist-v2':JSON.stringify({watched:[],watchlist:[{id:42,title:'Pick me',genres:[]}]})};
 const app=boot(async()=>response({genres:[]}),'watchlist.html',saved);
 app.dom['pick-movie'].listeners.click();app.dom['picker-watched'].listeners.click();
 assert.equal(app.run('pickedMovie'),null);
 app.dom['undo-action'].listeners.click();
 assert.equal(app.run('pickedMovie.tmdbId'),42);
 assert.equal(app.dom['picker-watched'].disabled,false);
 app.dom['picker-watched'].listeners.click();
 app.events.storage({key:'movielist-v2'});
 assert.equal(app.dom['undo-toast'].hidden,true);
 assert.equal(app.dom['dialog-undo'].disabled,true);
});

test('For You feedback changes sources, persists, hides films and can be undone or reset',async()=>{
 const saved={'movielist-v2':JSON.stringify({watched:[{id:1,title:'Seed',rating:5,genres:['Drama']}],watchlist:[]})};
 const calls=[];
 const fetch=async url=>{
  const params=new URL(url,'http://localhost').searchParams;calls.push(params);
  return response({results:params.get('id')==='42'?[{...tmdbMovie,id:99}]:[{...tmdbMovie,id:42},{...tmdbMovie,id:43}]});
 };
 const app=boot(fetch,'recommendations.html',saved);await tick();
 const find=id=>app.dom['recommendation-container'].children.find(card=>card.movieKey==='tmdb:'+id);
 const feedback=card=>card.children[1].children.find(node=>node.className==='recommendation-feedback');
 feedback(find(42)).children[0].listeners.click();await tick();
 assert.ok(calls.some(params=>params.get('id')==='42'&&params.get('action')==='recommendations'));
 assert.equal(feedback(find(42)).children[0].attributes['aria-pressed'],'true');
 assert.ok(find(99));
 assert.match(find(99).children[1].children[2].textContent,/asked for more like/);
 feedback(find(43)).children[1].listeners.click();await tick();
 assert.equal(find(43),undefined);
 assert.equal(JSON.parse(saved['movielist-v2']).recommendationFeedback.dismissed[0],43);
 app.dom['undo-action'].listeners.click();await tick();
 assert.ok(find(43));
 feedback(find(43)).children[1].listeners.click();await tick();
 const reload=boot(fetch,'recommendations.html',saved);await tick();
 assert.equal(reload.dom['recommendation-container'].children.some(card=>card.movieKey==='tmdb:43'),false);
 assert.equal(reload.run('Store.feedback(collection).moreLike.length'),1);
 app.dom['reset-recommendation-feedback'].listeners.click();await tick();
 assert.ok(find(43));
 assert.equal(app.run('Store.feedback(collection).moreLike.length'),0);
 app.dom['undo-action'].listeners.click();await tick();
 assert.equal(find(43),undefined);
 assert.equal(app.run('Store.feedback(collection).moreLike.length'),1);
 assert.equal(app.run('collection.watched[0].rating'),5);
});

test('More like this opens labelled results and publishes its first endpoint before other requests finish',async()=>{
 const saved={'movielist-v2':JSON.stringify({watched:[{id:1,title:'Seed',rating:5,genres:['Drama']}],watchlist:[],recommendationFeedback:{dismissed:[43],moreLike:[]}})};
 const pending=[];
 const app=boot(url=>{
  const params=new URL(url,'http://localhost').searchParams;
  if(params.get('id')==='42')return new Promise(resolve=>pending.push({action:params.get('action'),resolve}));
  return Promise.resolve(response({results:[{...tmdbMovie,id:42}]}));
 },'recommendations.html',saved);await tick();
 app.run("changeRecommendationFeedback({...catalog[0],id:42,tmdbId:42,title:'Interstellar',genres:['Drama']},'moreLike')");
 assert.equal(app.dom['related-dialog'].open,true);
 assert.match(app.dom['related-title'].textContent,/Interstellar/);
 assert.match(app.dom['related-message'].textContent,/Finding/);
 assert.equal(app.dom['related-container'].attributes['aria-busy'],'true');
 assert.deepEqual(pending.map(item=>item.action),['recommendations','similar']);
 pending.find(item=>item.action==='recommendations').resolve(response({results:[{...tmdbMovie,id:99},{...tmdbMovie,id:99},{...tmdbMovie,id:1},{...tmdbMovie,id:43}]}));await tick();
 assert.equal(app.dom['related-container'].children[0].movieKey,'tmdb:99');
 assert.equal(app.dom['related-container'].children.length,1);
 assert.equal(app.dom['recommendation-container'].children[0].movieKey,'tmdb:99');
 assert.equal(app.dom['related-container'].attributes['aria-busy'],'true');
 app.dom['related-undo'].listeners.click();
 assert.equal(app.dom['related-dialog'].open,false);
 assert.equal(app.run('Store.feedback(collection).moreLike.length'),0);
 assert.ok(!app.dom['recommendation-container'].children.some(card=>card.movieKey==='tmdb:99'));
 pending.find(item=>item.action==='similar').resolve(response({results:[{...tmdbMovie,id:100}]}));await tick();
 assert.ok(!app.dom['recommendation-container'].children.some(card=>card.movieKey==='tmdb:100'));
});

test('related source failures show an error while preserving the feedback',async()=>{
 const saved={'movielist-v2':JSON.stringify({watched:[],watchlist:[],recommendationFeedback:{dismissed:[],moreLike:[]}})};
 const app=boot(async url=>response(new URL(url,'http://localhost').searchParams.get('id')==='42'?{error:'unavailable'}:{results:[]},new URL(url,'http://localhost').searchParams.get('id')!=='42'),'recommendations.html',saved);
 app.run("changeRecommendationFeedback({id:42,tmdbId:42,title:'Interstellar',genres:['Drama']},'moreLike')");await tick();
 assert.match(app.dom['related-message'].textContent,/could not be loaded/);
 assert.equal(app.dom['related-retry'],undefined);
 assert.equal(app.run('Store.feedback(collection).moreLike[0].tmdbId'),42);
});

test('people profiles separate and deduplicate credits, update watched counts and reuse movie details', async () => {
 const saved={'movielist-v2':JSON.stringify({watched:[{id:42,title:'Saved film',rating:4.5,genres:[]}],watchlist:[]})};
 const person={id:7,name:'A Person',profile_path:'/face.jpg'};
 const app=boot(async url=>{
  const action=new URL(url,'http://localhost').searchParams.get('action');
  if(action==='person')return response({...person,biography:'A biography.'});
  if(action==='personCredits')return response({cast:[tmdbMovie,tmdbMovie,{...tmdbMovie,id:43}],crew:[{...tmdbMovie,job:'Director'},{...tmdbMovie,id:99,job:'Producer'}]});
  if(action==='details')return response({...tmdbMovie,credits:{cast:[{...person,character:'Hero'}],crew:[{...person,job:'Director'}]}});
  return response({genres:[],results:[]});
 },'watched.html',saved);
 await app.run('openDetails(collection.watched[0])');await tick();
 assert.equal(app.run('activeMovie.credits.cast[0].character'),'Hero');
 await app.run('openPerson(activeMovie.credits.cast[0])');
 assert.equal(app.dom['person-dialog'].open,true);
 assert.equal(app.run('activePerson.sections[0].movies.length'),2);
 assert.equal(app.run('activePerson.sections[1].movies.length'),1);
 assert.match(app.run('activePerson.sections[0].countNode.textContent'),/^1 of 2/);
 assert.equal(app.run('activePerson.sections[0].gridNode.children[0].attributes["data-watched"]'),'true');
 app.run("changeStatus(activePerson.sections[0].movies[1], 'watched')");
 assert.match(app.run('activePerson.sections[0].countNode.textContent'),/^2 of 2/);
 app.run("changeStatus(activePerson.sections[1].movies[0], 'watched')");
 assert.equal(app.run('collection.watched.length'),2);
 assert.equal(app.run('collection.watched.find(movie => movie.tmdbId === 42).rating'),4.5);
 app.run('activePerson.sections[0].gridNode.children[0].children[0].listeners.click()');await tick();
 assert.equal(app.dom['person-dialog'].open,false);
 assert.equal(app.dom['movie-dialog'].open,true);
 assert.equal(app.run('activeMovie.tmdbId'),42);
});

test('person failures preserve available biography, allow retry and ignore responses after close',async()=>{
 let fail=true;
 const app=boot(async url=>{
  const action=new URL(url,'http://localhost').searchParams.get('action');
  if(action==='person')return response({id:7,name:'Person',biography:''});
  if(action==='personCredits')return response(fail?{error:'Unavailable'}:{cast:[],crew:[]},!fail);
  return response({genres:[],results:[]});
 });
 await app.run('openPerson({id:7,name:"Person"})');
 assert.match(app.dom['person-content'].children[0].children[1].children[1].textContent,/Biography unavailable/);
 assert.ok(app.dom['person-content'].children.some(node=>node.textContent==='Retry profile'));
 fail=false;await app.run('openPerson(activePerson)');
 assert.equal(app.run('activePerson.sections[0].movies.length'),0);
 let finish;
 const stale=boot(url=>new URL(url,'http://localhost').searchParams.get('action')==='person'?new Promise(resolve=>{finish=resolve}):Promise.resolve(response({cast:[],crew:[],genres:[],results:[]})));
 const pending=stale.run('openPerson({id:7,name:"Person"})');
 stale.dom['person-dialog'].close();finish(response({id:7,name:'Late'}));await pending;
 assert.equal(stale.run('activePerson'),null);
 assert.equal(stale.dom['person-dialog'].open,false);
});


test('old optional metadata does not change initialization, ratings or existing Undo flows',async()=>{
 const raw={watched:[{...tmdbMovie,tmdbId:42,rating:4.5,watchedDate:'2020-01-01',ratedAt:'old',ratingUpdatedAt:null}],watchlist:[],favorites:['tmdb:42'],recommendationFeedback:{dismissed:[99],moreLike:[]},activity:[{type:'watched',at:'old'}]};
 for(const page of ['index.html','watched.html','watchlist.html','stats.html','recommendations.html']){
  const saved={'movielist-v2':JSON.stringify(raw)},before=saved['movielist-v2'];
  const app=boot(async()=>response({genres:[],results:[]} ),page,saved);await tick();
  assert.equal(saved['movielist-v2'],before,'initialization must not rewrite storage');
  assert.equal(app.run('collection.watched[0].rating'),4.5);assert.equal(app.run('collection.favorites[0]'),'tmdb:42');
  app.run("changeStatus(collection.watched[0],'watchlist')");app.dom['undo-action'].listeners.click();
  assert.equal(app.run('collection.watched[0].rating'),4.5);assert.equal(app.run('collection.favorites[0]'),'tmdb:42');
  app.run('changeRating(collection.watched[0],3.5)');
  assert.equal(JSON.parse(saved['movielist-v2']).watched[0].rating,3.5);
  assert.equal(JSON.parse(saved['movielist-v2']).recommendationFeedback.dismissed[0],99);
 }
});

test('unreadable storage is never overwritten and failed writes preserve the last saved collection',async()=>{
 const damaged={'movielist-v2':'{unreadable'};
 const app=boot(async()=>response({genres:[],results:[tmdbMovie],total_pages:1}),'index.html',damaged);await tick();
 app.run("changeStatus(catalog[0],'watched')");
 assert.equal(damaged['movielist-v2'],'{unreadable');assert.match(app.dom.status.textContent,/left untouched/);
 const original=JSON.stringify({watched:[{...tmdbMovie,tmdbId:42,rating:4.5}],watchlist:[],favorites:['tmdb:42']});
 damaged['movielist-v2']=original;app.events.storage({key:'movielist-v2'});
 assert.equal(app.run('collection.watched[0].rating'),4.5);assert.equal(app.run('storageLocked'),false);
 app.run('localStorage.setItem = () => { throw Error("Quota exceeded"); }');app.run('changeRating(collection.watched[0], 2)');
 assert.equal(damaged['movielist-v2'],original);assert.equal(app.run('collection.watched[0].rating'),2);assert.match(app.dom.status.textContent,/could not be saved/);
 app.run('refreshCollection()');assert.equal(app.run('collection.watched[0].rating'),4.5);assert.equal(app.run('collection.favorites[0]'),'tmdb:42');
});
