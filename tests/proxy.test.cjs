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

test('proxy recommendation/similar/discover routes are allowlisted, validated and credential-safe', async () => {
  const oldToken=process.env.TMDB_READ_TOKEN, oldFetch=global.fetch;
  process.env.TMDB_READ_TOKEN='test-only-token';
  try {
    let called;
    global.fetch=async(url,options)=>{called={url,options};return {ok:true,json:async()=>({results:[]})};};
    for(const action of ['recommendations','similar']) {
      for(const id of ['', '../account', '1/recommendations', 'http://evil.example']) assert.equal((await handler(request({action,id}))).statusCode,400);
      const response=await handler(request({action,id:'42',page:'2'}));
      assert.equal(response.statusCode,200);
      assert.equal(called.url.origin,'https://api.themoviedb.org');
      assert.equal(called.url.pathname,`/3/movie/42/${action}`);
      assert.equal(called.url.searchParams.get('page'),'2');
      assert.equal(called.options.headers.Authorization,'Bearer test-only-token');
      assert.ok(!response.body.includes('test-only-token'));
    }
    await handler(request({action:'discover',genre:'878'}));
    assert.equal(called.url.pathname,'/3/discover/movie');
    assert.equal(called.url.searchParams.get('with_genres'),'878');
    assert.equal(called.url.searchParams.get('include_adult'),'false');
    assert.equal((await handler(request({action:'discover',genre:'878|18'}))).statusCode,400);
    global.fetch=async()=>{throw Error('private authorization information');};
    const result=await handler(request({action:'recommendations',id:'42'}));
    assert.equal(result.statusCode,502);
    assert.ok(!result.body.includes('private'));
  } finally {
    global.fetch=oldFetch;
    if(oldToken===undefined)delete process.env.TMDB_READ_TOKEN;else process.env.TMDB_READ_TOKEN=oldToken;
  }
});

test('Discover forwards combined date/genre/sort filters and applies a vote floor only for highest rated', async()=>{
 const oldToken=process.env.TMDB_READ_TOKEN,oldFetch=global.fetch;
 process.env.TMDB_READ_TOKEN='test-token';
 try {
  let called;
  global.fetch=async url=>{called=url;return {ok:true,json:async()=>({results:[],total_pages:3})};};
  for(const sort of ['popularity.desc','vote_average.desc','vote_count.desc']) {
   const result=await handler(request({action:'discover',genre:'18',year_from:'1980',year_to:'1989',sort,page:'2'}));
   assert.equal(result.statusCode,200);
   assert.equal(called.pathname,'/3/discover/movie');
   assert.equal(called.searchParams.get('with_genres'),'18');
   assert.equal(called.searchParams.get('primary_release_date.gte'),'1980-01-01');
   assert.equal(called.searchParams.get('primary_release_date.lte'),'1989-12-31');
   assert.equal(called.searchParams.get('sort_by'),sort);
   assert.equal(called.searchParams.get('vote_count.gte'),sort==='vote_average.desc'?'1000':null);
   assert.equal(called.searchParams.get('page'),'2');
  }
  await handler(request({action:'discover',year_to:'1969',sort:'vote_count.desc'}));
  assert.equal(called.searchParams.get('primary_release_date.gte'),null);
  assert.equal(called.searchParams.get('primary_release_date.lte'),'1969-12-31');
 } finally {global.fetch=oldFetch;if(oldToken===undefined)delete process.env.TMDB_READ_TOKEN;else process.env.TMDB_READ_TOKEN=oldToken;}
});

test('proxy rejects malformed years, inverted ranges and unsupported sorts before upstream access',async()=>{
 const oldFetch=global.fetch;
 let calls=0;global.fetch=async()=>{calls++;throw Error('Should not fetch');};
 try {
  for(const params of [{year_from:'1799'},{year_to:'2101'},{year_from:'1990-01-01'},{year_from:'1e3'},{year_from:'2020',year_to:'1990'},{sort:'vote_average.desc&api_key=secret'},{sort:'invalid'},{sort:'primary_release_date.desc'},{sort:'primary_release_date.asc'},{action:'search',query:'Film',sort:'popularity.desc'},{action:'details',id:'42',year_from:'1990'}]) {
   assert.equal((await handler(request({action:'discover',...params}))).statusCode,400);
  }
  assert.equal(calls,0);
 } finally {global.fetch=oldFetch;}
});

test('search/trending apply combined year/genre filters on every upstream page without losing pagination',async()=>{
 const oldToken=process.env.TMDB_READ_TOKEN,oldFetch=global.fetch;process.env.TMDB_READ_TOKEN='test-token';
 try {
  let called;
  global.fetch=async url=>{called=url;return {ok:true,json:async()=>({page:2,total_pages:8,results:[{id:1,release_date:'1985-06-01',genre_ids:[18]},{id:2,release_date:'2020-01-01',genre_ids:[18]},{id:3,release_date:'1985-01-01',genre_ids:[35]},{id:4,release_date:'',genre_ids:[18]}]})};};
  for(const action of ['search','trending']) {
   const result=await handler(request({action,query:'Film',genre:'18',year_from:'1980',year_to:'1989',page:'2'}));
   const data=JSON.parse(result.body);
   assert.deepEqual(data.results.map(movie=>movie.id),[1]);
   assert.equal(data.total_pages,8);
   assert.equal(data.page,2);
   assert.equal(called.searchParams.get('sort_by'),null);
  }
  await handler(request({action:'search',query:'Film',year_from:'1985',year_to:'1985'}));
  assert.equal(called.searchParams.get('primary_release_year'),'1985');
 } finally {global.fetch=oldFetch;if(oldToken===undefined)delete process.env.TMDB_READ_TOKEN;else process.env.TMDB_READ_TOKEN=oldToken;}
});

test('person endpoints validate IDs and use only fixed authenticated routes; movie credits are appended server-side',async()=>{
 const oldToken=process.env.TMDB_READ_TOKEN,oldFetch=global.fetch;process.env.TMDB_READ_TOKEN='private-test-token';
 try {
  let called,calls=0;global.fetch=async(url,options)=>{calls++;called={url,options};return {ok:true,json:async()=>({id:7})};};
  for(const action of ['person','personCredits']) {
   for(const id of ['', '0', '-1', '1.5', '../account', '7/movie_credits', 'https://evil.example', '12345678901'])assert.equal((await handler(request({action,id}))).statusCode,400);
   assert.equal(calls,action==='person'?0:1);
   const result=await handler(request({action,id:'7',append_to_response:'external_ids'}));
   assert.equal(result.statusCode,200);
   assert.equal(called.url.pathname,action==='person'?'/3/person/7':'/3/person/7/movie_credits');
   assert.equal(called.url.origin,'https://api.themoviedb.org');
   assert.equal(called.url.searchParams.get('append_to_response'),null);
   assert.equal(called.options.headers.Authorization,'Bearer private-test-token');
   assert.ok(!result.body.includes('private-test-token'));
  }
  await handler(request({action:'details',id:'42',append_to_response:'account_states'}));
  assert.equal(called.url.searchParams.get('append_to_response'),'credits');
 } finally {global.fetch=oldFetch;if(oldToken===undefined)delete process.env.TMDB_READ_TOKEN;else process.env.TMDB_READ_TOKEN=oldToken;}
});
