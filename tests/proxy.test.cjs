const test = require('node:test');
const assert = require('node:assert/strict');
const { handler } = require('../netlify/functions/tmdb.cjs');
const request = params => ({ httpMethod: 'GET', queryStringParameters: params });
test('proxy validates methods, actions, pages, queries and IDs before calling upstream', async () => {
  assert.equal((await handler({ httpMethod: 'POST' })).statusCode, 405);
  for (const params of [{ action: 'https://evil.example' }, { page: '501' }, { page: '1.5' }, { action: 'details', id: '../account' }, { action: 'search', query: ' ' }]) assert.equal((await handler(request(params))).statusCode, 400);
});
test('proxy handles missing credentials without contacting TMDB', async () => {
  const old = process.env.TMDB_READ_TOKEN;
  delete process.env.TMDB_READ_TOKEN;
  try { assert.equal((await handler(request({}))).statusCode, 503); }
  finally { if (old !== undefined) process.env.TMDB_READ_TOKEN = old; }
});
test('proxy forwards server authorization only to fixed TMDB routes and hides upstream errors', async () => {
  const oldToken = process.env.TMDB_READ_TOKEN, oldFetch = global.fetch;
  process.env.TMDB_READ_TOKEN = 'test-token-not-a-real-secret';
  try {
    let called;
    global.fetch = async (url, options) => { called = { url, options }; return { ok: true, json: async () => ({ results: [] }) }; };
    const response = await handler(request({ action: 'search', query: 'A & B', page: '2' }));
    assert.equal(response.statusCode, 200);
    assert.equal(called.url.origin, 'https://api.themoviedb.org');
    assert.equal(called.url.pathname, '/3/search/movie');
    assert.equal(called.url.searchParams.get('query'), 'A & B');
    assert.equal(called.url.searchParams.get('page'), '2');
    assert.equal(called.options.headers.Authorization, 'Bearer test-token-not-a-real-secret');
    assert.ok(!response.body.includes('test-token'));
    for (const status of [401, 403, 404, 429, 500]) {
      global.fetch = async () => ({ ok: false, status });
      const result = await handler(request({ action: 'popular' }));
      assert.equal(result.statusCode, status === 404 || status === 429 ? status : 502);
      assert.ok(!result.body.includes('test-token'));
    }
    global.fetch = async () => { throw Error('private upstream information'); };
    const error = await handler(request({}));
    assert.equal(error.statusCode, 502);
    assert.ok(!error.body.includes('private upstream'));
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TMDB_READ_TOKEN;
    else process.env.TMDB_READ_TOKEN = oldToken;
  }
});

test('proxy validates genre IDs and uses genre-aware discovery for popular movies', async () => {
  const oldToken = process.env.TMDB_READ_TOKEN, oldFetch = global.fetch;
  process.env.TMDB_READ_TOKEN = 'test-token';
  try {
    let called;
    global.fetch = async url => { called = url; return { ok: true, json: async () => ({ results: [] }) }; };
    for (const genre of ['../account', '18|35', '9999', '-18']) assert.equal((await handler(request({ genre }))).statusCode, 400);
    assert.equal((await handler(request({ action: 'popular', genre: '18', page: '3' }))).statusCode, 200);
    assert.equal(called.pathname, '/3/discover/movie');
    assert.equal(called.searchParams.get('with_genres'), '18');
    assert.equal(called.searchParams.get('page'), '3');
    assert.equal(called.searchParams.get('sort_by'), 'popularity.desc');
    await handler(request({ action: 'popular' }));
    assert.equal(called.pathname, '/3/movie/popular');
    await handler(request({ action: 'search', query: 'film', genre: '18' }));
    assert.equal(called.pathname, '/3/search/movie');
    assert.equal(called.searchParams.get('with_genres'), null);
  } finally {
    global.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.TMDB_READ_TOKEN; else process.env.TMDB_READ_TOKEN = oldToken;
  }
});
