const test = require('node:test');
const assert = require('node:assert/strict');
const Store = require('../collection.js');
const storage = data => ({ getItem: key => data[key] ?? null });
const movie = { id: 42, tmdbId: 42, title: 'A film', year: '2024', poster_path: '/poster.jpg', overview: 'Synopsis', genres: ['Drama'], rating: 0 };
test('fresh collection has no watched films or personal ratings', () => {
  assert.deepEqual(Store.load(storage({})), { watched: [], watchlist: [], favorites: [] });
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
  assert.deepEqual(reloaded, { ...data, favorites: [] });
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

const film = id => ({ ...movie, id, tmdbId: id, title: `Film ${id}`, rating: 4 });
test('favorites are watched-only, unique, limited to four, removable and replaceable', () => {
  const data = Store.normalize({ watched: [1,2,3,4,5].map(film), watchlist: [film(6)] });
  assert.equal(Store.toggleFavorite(data, film(6)), false);
  for (const id of [1,2,3,4]) assert.equal(Store.toggleFavorite(data, film(id)), true);
  assert.equal(Store.toggleFavorite(data, film(5)), false);
  assert.deepEqual(Store.favorites(data).map(movie => movie.tmdbId), [1,2,3,4]);
  assert.equal(Store.replaceFavorite(data, film(2), film(5)), true);
  assert.deepEqual(Store.favorites(data).map(movie => movie.tmdbId), [1,5,3,4]);
  assert.equal(Store.replaceFavorite(data, film(1), film(5)), false);
  assert.equal(Store.toggleFavorite(data, film(5)), true);
  assert.equal(Store.isFavorite(data, film(5)), false);
  assert.deepEqual(data.watched.map(movie => movie.rating), [4,4,4,4,4]);
});

test('favorites reorder, persist, and disappear automatically when leaving Watched', () => {
  const data = Store.normalize({ watched: [1,2,3].map(film), watchlist: [] });
  for (const item of data.watched) Store.toggleFavorite(data, item);
  assert.equal(Store.moveFavorite(data, film(1), -1), false);
  assert.equal(Store.moveFavorite(data, film(2), -1), true);
  assert.deepEqual(Store.favorites(data).map(movie => movie.tmdbId), [2,1,3]);
  const loaded = Store.load(storage({ [Store.KEY]: JSON.stringify(data) }));
  assert.deepEqual(loaded, data);
  Store.setStatus(loaded, film(2), 'watchlist');
  Store.setStatus(loaded, film(3), 'neutral');
  assert.deepEqual(Store.favorites(loaded).map(movie => movie.tmdbId), [1]);
  Store.setStatus(loaded, film(2), 'watched');
  assert.equal(Store.isFavorite(loaded, film(2)), false);
});

test('favorite normalization drops invalid references and preserves legacy favorites through linking', () => {
  const raw = { watched: [1,2,3,4,5].map(film), watchlist: [film(6)], favorites: ['tmdb:6','bad','tmdb:2','tmdb:2','tmdb:1','tmdb:3','tmdb:4','tmdb:5'] };
  const data = Store.normalize(raw);
  assert.deepEqual(data.favorites, ['tmdb:2','tmdb:1','tmdb:3','tmdb:4']);
  const legacy = Store.normalize({ watched: [{ title: 'Legacy', year: 1980, rating: 4.5 }], watchlist: [film(1)] });
  Store.toggleFavorite(legacy, legacy.watched[0]);
  const loaded = Store.load(storage({ [Store.KEY]: JSON.stringify(legacy) }));
  Store.link(loaded, loaded.watched[0], film(1));
  assert.equal(Store.favorites(loaded)[0].tmdbId, 1);
  assert.equal(Store.favorites(loaded)[0].rating, 4.5);
});

test('random picker handles empty/single lists, uses the full watchlist and avoids consecutive repeats', () => {
  assert.equal(Store.pickRandom({ watchlist: [] }), null);
  const data = { watched: [film(9)], watchlist: [film(1),film(2),film(3)] };
  assert.equal(Store.pickRandom(data, null, () => 0).tmdbId, 1);
  assert.equal(Store.pickRandom(data, null, () => 0.999).tmdbId, 3);
  assert.equal(Store.pickRandom(data, film(2), () => 0).tmdbId, 1);
  assert.equal(Store.pickRandom(data, film(2), () => 0.999).tmdbId, 3);
  assert.equal(Store.pickRandom({ watchlist: [film(1)] }, film(1)).tmdbId, 1);
  let previous = null;
  for (let i = 0; i < 100; i++) {
    const picked = Store.pickRandom(data, previous);
    assert.notEqual(picked.tmdbId, previous?.tmdbId);
    previous = picked;
  }
  const picked = Store.pickRandom(data, null, () => 0);
  Store.setStatus(data, picked, 'watched');
  assert.equal(data.watchlist.some(movie => movie.tmdbId === picked.tmdbId), false);
  assert.equal(Store.status(data, picked), 'watched');
  assert.equal(Store.find(data, picked).rating, 0);
});

test('status undo restores rating, collection order and favorite slot while retaining unrelated edits',()=>{
 const data=Store.normalize({watched:[film(1),film(2),film(3)],watchlist:[film(4)],favorites:['tmdb:1','tmdb:2']});
 data.watched[0].rating=4.5;
 const token=Store.changeStatusWithUndo(data,data.watched[0],'watchlist');
 assert.equal(data.watchlist.at(-1).rating,0);
 assert.deepEqual(data.favorites,['tmdb:2']);
 data.watched[0].rating=2.5;
 Store.setStatus(data,film(5),'watchlist');
 assert.equal(Store.undoStatus(data,token),true);
 assert.deepEqual(data.watched.map(movie=>movie.tmdbId),[1,2,3]);
 assert.equal(data.watched[0].rating,4.5);
 assert.equal(data.watched[1].rating,2.5);
 assert.deepEqual(data.favorites,['tmdb:1','tmdb:2']);
 assert.deepEqual(data.watchlist.map(movie=>movie.tmdbId),[4,5]);
});

test('status undo supports additions/removals and refuses to overwrite newer target changes',()=>{
 const data=Store.normalize({watched:[],watchlist:[film(1),film(2)]});
 const removed=Store.changeStatusWithUndo(data,data.watchlist[0],'neutral');
 assert.equal(Store.undoStatus(data,removed),true);
 assert.deepEqual(data.watchlist.map(movie=>movie.tmdbId),[1,2]);
 const added=Store.changeStatusWithUndo(data,film(3),'watched');
 assert.equal(Store.undoStatus(data,added),true);
 assert.equal(Store.status(data,film(3)),'neutral');
 const changed=Store.changeStatusWithUndo(data,film(1),'watched');
 Store.find(data,film(1)).rating=5;
 assert.equal(Store.undoStatus(data,changed),false);
 assert.equal(Store.find(data,film(1)).rating,5);
});

test('undo never displaces a newer favorite when all Top 4 slots are filled',()=>{
 const data=Store.normalize({watched:[1,2,3,4,5].map(film),watchlist:[],favorites:['tmdb:1','tmdb:2','tmdb:3','tmdb:4']});
 const token=Store.changeStatusWithUndo(data,film(1),'watchlist');
 Store.toggleFavorite(data,film(5));
 const before=JSON.stringify(data);
 assert.equal(Store.undoStatus(data,token),false);
 assert.equal(JSON.stringify(data),before);
});

test('recommendation feedback persists separately from ratings and supports reversible exclusive states',()=>{
 const data=Store.normalize({watched:[film(1)],watchlist:[film(2)],favorites:['tmdb:1']});
 const original=JSON.stringify({watched:data.watched,watchlist:data.watchlist,favorites:data.favorites});
 Store.setFeedback(data,film(2),'moreLike');
 Store.setFeedback(data,film(3),'moreLike');
 assert.equal(Store.feedbackState(data,film(2)),'moreLike');
 const hidden=Store.setFeedback(data,film(2),'dismissed');
 assert.equal(Store.feedbackState(data,film(2)),'dismissed');
 assert.equal(Store.feedback(data).moreLike.length,1);
 assert.equal(Store.undoFeedback(data,hidden),true);
 assert.deepEqual(Store.feedback(data).moreLike.map(movie=>movie.tmdbId),[3,2]);
 const loaded=Store.load(storage({[Store.KEY]:JSON.stringify(data)}));
 assert.deepEqual(loaded,data);
 assert.equal(JSON.stringify({watched:data.watched,watchlist:data.watchlist,favorites:data.favorites}),original);
 assert.equal(Store.setFeedback(data,{title:'Legacy',tmdbId:null},'moreLike'),null);
});

test('feedback normalization removes invalid entries without losing existing personal data',()=>{
 const data=Store.normalize({watched:[film(1)],watchlist:[],recommendationFeedback:{dismissed:[2,2,-1,'3'],moreLike:[film(2),film(3),film(3),{title:'No ID'}]}});
 assert.deepEqual(data.recommendationFeedback.dismissed,[2]);
 assert.deepEqual(data.recommendationFeedback.moreLike.map(movie=>movie.tmdbId),[3]);
 assert.equal(data.watched[0].rating,4);
});


test('collections with retired metadata retain movies, ratings, favorites and feedback through reload and Undo',()=>{
 const retired={watchedDate:'2020-01-01',ratedAt:'invalid old timestamp',ratingUpdatedAt:{unexpected:true}};
 const raw={watched:[{...film(1),...retired},{...film(2),watchedDate:null}],watchlist:[{...film(3),...retired}],favorites:['tmdb:1'],recommendationFeedback:{dismissed:[99],moreLike:[film(4)]},activity:[null,{type:'rated',at:'invalid',movie:film(1)}]};
 const serialized=JSON.stringify(raw),data=Store.load(storage({[Store.KEY]:serialized}));
 const expected=Store.normalize({watched:[film(1),film(2)],watchlist:[film(3)],favorites:['tmdb:1'],recommendationFeedback:raw.recommendationFeedback});
 assert.deepEqual(data,expected);assert.equal(JSON.stringify(raw),serialized);
 const beforeStats=Store.statistics(data);
 const token=Store.changeStatusWithUndo(data,film(1),'watchlist');assert.equal(Store.undoStatus(data,token),true);
 assert.deepEqual(Store.statistics(data),beforeStats);assert.deepEqual(data.favorites,['tmdb:1']);
 const feedback=Store.setFeedback(data,film(4),'dismissed');assert.equal(Store.undoFeedback(data,feedback),true);
 assert.deepEqual(Store.feedback(data),Store.feedback(expected));
 const reloaded=Store.load(storage({[Store.KEY]:JSON.stringify(data)}));assert.deepEqual(reloaded,expected);
});
