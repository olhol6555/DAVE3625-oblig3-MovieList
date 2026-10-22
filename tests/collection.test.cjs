const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../collection.js');
const storage = data => ({ getItem: key => data[key] ?? null });
const movie = { id: 42, tmdbId: 42, title: 'A film', year: '2024', poster_path: '/poster.jpg', overview: 'Synopsis', genres: ['Drama'], rating: 0 };
test('fresh collection has no watched films or personal ratings', () => {
  assert.deepEqual(Store.load(storage({})), { watched: [], watchlist: [] });
});
test('status changes use TMDB IDs, move without duplicates, and clear ratings outside watched', () => {
  const data = { watched: [], watchlist: [] };
  assert.equal(Store.status(data, movie), 'neutral');
  Store.setStatus(data, movie, 'watched');
  data.watched[0].rating = 4.5;
  Store.setStatus(data, { ...movie, title: 'Translated title' }, 'watched');
  assert.equal(data.watched.length, 1);
  assert.equal(data.watched[0].rating, 4.5);
  Store.setStatus(data, movie, 'watchlist');
  assert.equal(data.watched.length, 0);
  assert.equal(data.watchlist[0].rating, 0);
  Store.setStatus(data, movie, 'watched');
  assert.equal(data.watchlist.length, 0);
  assert.equal(data.watched[0].rating, 0);
  Store.setStatus(data, movie, 'neutral');
  assert.equal(Store.status(data, movie), 'neutral');
});
test('saved metadata and optional half-star rating survive reload', () => {
  const data = { watched: [{ ...movie, rating: 0.5 }], watchlist: [] };
  const reloaded = Store.load(storage({ [Store.KEY]: JSON.stringify(data) }));
  assert.deepEqual(reloaded, data);
  for (const invalid of [0.1, 5.5, -1, '4', NaN]) assert.equal(Store.rating(invalid), 0);
});
test('migrates old data without inventing IDs, changing ratings or mutating original storage', () => {
  const original = { watched: [{ id: 'old', title: 'Old film', year: 2000, rating: 3.5 }], watchlist: [{ title: 'Later', year: 2020 }] };
  const serialized = JSON.stringify(original);
  const data = Store.load(storage({ 'movielist-v1': serialized }));
  assert.equal(data.watched[0].rating, 3.5);
  assert.equal(data.watched[0].tmdbId, null);
  assert.equal(JSON.stringify(original), serialized);
  assert.equal(Store.load(storage({ movies: '[]' })).watched.length, 0);
  assert.throws(() => Store.load(storage({ [Store.KEY]: '{' })));
});
test('explicit linking preserves ratings and merges an existing TMDB entry', () => {
  const data = Store.normalize({ watched: [{ title: 'Old film', year: 2024, rating: 4 }], watchlist: [movie] });
  Store.link(data, data.watched[0], movie);
  assert.equal(data.watched.length, 1);
  assert.equal(data.watchlist.length, 0);
  assert.equal(data.watched[0].tmdbId, 42);
  assert.equal(data.watched[0].rating, 4);
});
test('normalization removes duplicate TMDB IDs and disallows watchlist ratings', () => {
  const data = Store.normalize({ watched: [movie, movie], watchlist: [movie, { ...movie, id: 99, tmdbId: 99, rating: 4 }] });
  assert.equal(data.watched.length, 1);
  assert.equal(data.watchlist.length, 1);
  assert.equal(data.watchlist[0].rating, 0);
});
