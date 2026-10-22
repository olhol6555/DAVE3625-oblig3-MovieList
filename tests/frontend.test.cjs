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
  for (const file of ['collection.js', 'script.js']) vm.runInContext(fs.readFileSync(path.join(root, file), 'utf8'), context);
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

test('three pages have working navigation, isolated views and consistent active links', () => {
  for (const page of ['index.html', 'watched.html', 'watchlist.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    const nav = html.match(/<nav[\s\S]*?<\/nav>/)[0];
    for (const target of ['index.html', 'watched.html', 'watchlist.html']) {
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
  for (const page of ['index.html', 'watched.html', 'watchlist.html']) {
    const html = fs.readFileSync(path.join(root, page), 'utf8');
    assert.ok(!html.includes('export-collection'));
    assert.ok(!html.includes('backup-controls'));
    assert.ok(html.includes('All Genres'));
    assert.ok(html.includes('Science Fiction'));
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
  for (const page of ['index.html','watched.html','watchlist.html']) {
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
