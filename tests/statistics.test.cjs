const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../collection.js');
const movie = (id, rating = 0, genres = [], year = '') => ({ id, tmdbId:id, title:`Film ${id}`, rating, genres, year });

test('statistics for an empty collection have no invented averages or data', () => {
  const result = Store.statistics({watched:[],watchlist:[]});
  assert.equal(result.watchedCount, 0);
  assert.equal(result.watchlistCount, 0);
  assert.equal(result.ratedCount, 0);
  assert.equal(result.averageRating, null);
  assert.deepEqual(result.genres, []);
  assert.deepEqual(result.decades, []);
  assert.deepEqual(result.highestRated, []);
  assert.equal(result.ratingDistribution.length, 10);
  assert.ok(result.ratingDistribution.every(bin => bin.count === 0));
});

test('unrated movies count as watched but do not affect personal rating statistics', () => {
  const data = {watched:[movie(1),movie(2,0,['Drama'])],watchlist:[movie(3,5,['Comedy'])]};
  const result = Store.statistics(data);
  assert.equal(result.watchedCount, 2);
  assert.equal(result.watchlistCount, 1);
  assert.equal(result.ratedCount, 0);
  assert.equal(result.averageRating, null);
  assert.equal(result.missingGenres, 1);
  assert.deepEqual(result.genres, [{name:'Drama',count:1}]);
  assert.equal(result.ratingDistribution.reduce((sum, bin) => sum + bin.count, 0), 0);
});

test('multi-genre films contribute once per genre and averages exclude unrated/invalid values', () => {
  const data = {watched:[movie(1,0.5,['Drama','Comedy','Drama'],'1999'),movie(2,4.5,['Drama'],'2001'),movie(3,0,[],'unknown'),movie(4,3.2,undefined,'')],watchlist:[movie(5,5,['Action'],'2020')]};
  const original = JSON.stringify(data);
  const result = Store.statistics(data);
  assert.equal(result.ratedCount, 2);
  assert.equal(result.averageRating, 2.5);
  assert.deepEqual(result.genres, [{name:'Drama',count:2},{name:'Comedy',count:1}]);
  assert.equal(result.ratingDistribution[0].count, 1);
  assert.equal(result.ratingDistribution[8].count, 1);
  assert.equal(result.missingGenres, 2);
  assert.deepEqual(result.decades, [{name:'1990s',count:1},{name:'2000s',count:1}]);
  assert.equal(result.missingYears, 2);
  assert.equal(JSON.stringify(data), original);
});

test('all half-star bins, top eight ordering and rating average use actual personal ratings', () => {
  const data = {watched:Array.from({length:10}, (_, i) => movie(i+1,(i+1)/2)),watchlist:[]};
  const result = Store.statistics(data);
  assert.deepEqual(result.ratingDistribution.map(bin => bin.rating), [0.5,1,1.5,2,2.5,3,3.5,4,4.5,5]);
  assert.ok(result.ratingDistribution.every(bin => bin.count === 1));
  assert.equal(result.averageRating, 2.75);
  assert.equal(result.highestRated.length, 8);
  assert.deepEqual(result.highestRated.map(movie => movie.rating), [5,4.5,4,3.5,3,2.5,2,1.5]);
  assert.equal(data.watched[0].rating, 0.5);
});

test('statistics recalculate after ratings, removals and collection moves without changing favorites', () => {
  const data = Store.normalize({watched:[movie(1,4,['Drama'],'1982')],watchlist:[movie(2)],favorites:['tmdb:1']});
  assert.equal(Store.statistics(data).averageRating, 4);
  data.watched[0].rating = 5;
  assert.equal(Store.statistics(data).averageRating, 5);
  Store.setStatus(data, data.watchlist[0], 'watched');
  assert.equal(Store.statistics(data).watchedCount, 2);
  assert.equal(Store.statistics(data).ratedCount, 1);
  assert.equal(Store.statistics(data).watchlistCount, 0);
  assert.deepEqual(data.favorites, ['tmdb:1']);
  Store.setStatus(data, data.watched[0], 'watchlist');
  assert.equal(Store.statistics(data).ratedCount, 0);
  assert.deepEqual(Store.statistics(data).genres, []);
  Store.setStatus(data, data.watched[0], 'neutral');
  assert.equal(Store.statistics(data).watchedCount, 0);
});
