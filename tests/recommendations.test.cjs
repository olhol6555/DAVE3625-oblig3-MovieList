const test=require('node:test');
const assert=require('node:assert/strict');
const Store=require('../collection.js');
const Rec=require('../recommendations.js');
const genres=new Map([[18,'Drama'],[878,'Science Fiction'],[35,'Comedy']]);
const film=(id,rating=0,names=[])=>({id,tmdbId:id,title:`Film ${id}`,rating,genres:names,year:'2020'});
const candidate=(id,ids=[])=>({id,title:`Candidate ${id}`,release_date:'2024-01-01',genre_ids:ids,poster_path:'/poster.jpg',overview:'Synopsis'});

test('empty collections require onboarding or optional valid genre preferences without defaults',()=>{
 const data=Store.normalize({watched:[],watchlist:[]});
 const taste=Rec.profile(data,genres);
 assert.deepEqual(Rec.sources(taste),[]);
 assert.deepEqual(Rec.rank(data,taste,[]),[]);
 const selected=Rec.profile(data,genres,[18,18,999]);
 assert.equal(selected.genres.length,1);
 assert.equal(Rec.sources(selected)[0].kind,'discover');
 assert.equal(selected.genres[0].preferred,true);
 assert.equal(data.watched.length,0);
});
test('high ratings are weighted above lower ratings and Top 4 earns an additional boost',()=>{
 const data=Store.normalize({watched:[film(1,4,['Drama']),film(2,5,['Science Fiction']),film(3,2,['Comedy']),film(4,0,['Comedy'])],watchlist:[],favorites:['tmdb:4']});
 const original=JSON.stringify(data);
 const taste=Rec.profile(data,genres);
 assert.deepEqual(taste.seeds.map(seed=>seed.tmdbId),[4,2,1]);
 assert.equal(taste.genreWeights.get(18),2);
 assert.equal(taste.genreWeights.get(878),4);
 assert.equal(taste.genreWeights.get(35),6);
 const batches=taste.seeds.map(seed=>({kind:'recommendations',seed,weight:seed.weight,results:[candidate(seed.tmdbId+10)]}));
 const ranked=Rec.rank(data,taste,batches);
 assert.deepEqual(ranked.map(movie=>movie.id),[14,12,11]);
 assert.match(ranked[0].recommendationReason,/Top 4/);
 assert.match(ranked[1].recommendationReason,/Because you liked Film 2/);
 assert.equal(JSON.stringify(data),original);
});
test('ranking combines independent sources, deduplicates IDs and excludes watched/adult/invalid films',()=>{
 const data=Store.normalize({watched:[film(1,5,['Drama']),{title:'Old film',year:'1990',rating:4,genres:[]}],watchlist:[film(10)]});
 const taste=Rec.profile(data,genres),seed=taste.seeds[0];
 const rec={kind:'recommendations',seed,weight:seed.weight,results:[candidate(1),candidate(10,[18]),candidate(10),candidate(11),{...candidate(20),adult:true},{...candidate(21),id:-1},{...candidate(22),title:'Old film',release_date:'1990-03-01'}]};
 const sim={kind:'similar',seed,weight:seed.weight,results:[candidate(11)]};
 const ranked=Rec.rank(data,taste,[rec,sim,rec]);
 assert.equal(new Set(ranked.map(movie=>movie.id)).size,ranked.length);
 assert.deepEqual(ranked.map(movie=>movie.id).sort((a,b)=>a-b),[10,11]);
 assert.ok(ranked.some(movie=>movie.id===10)); // Watchlist entries remain actionable.
 assert.deepEqual(Rec.rank(data,taste,[sim,rec]),ranked);
});
test('genre affinity, source rank and stable ID ties produce repeatable non-random ordering',()=>{
 const data=Store.normalize({watched:[film(1,5,['Drama'])],watchlist:[]});
 const taste=Rec.profile(data,genres),genre=taste.genres[0];
 const batch={kind:'discover',genre,weight:genre.weight,results:[candidate(11),candidate(12,[18])]};
 assert.equal(Rec.rank(data,taste,[batch])[0].id,12);
 assert.match(Rec.rank(data,taste,[batch])[0].recommendationReason,/Drama highly/);
 assert.deepEqual(Rec.rank(data,taste,[batch]),Rec.rank(data,taste,[batch]));
 const preferred=Rec.profile({watched:[],watchlist:[]},genres,[18]);
 assert.match(Rec.rank({watched:[],watchlist:[]},preferred,[{...batch,genre:preferred.genres[0]}])[0].recommendationReason,/interest in Drama/);
});
test('legacy favorites inform genres without fabricated TMDB IDs and source requests stay bounded',()=>{
 const data=Store.normalize({watched:[{title:'Legacy',year:1990,rating:5,genres:['Drama']},...Array.from({length:10},(_,i)=>film(i+1,5,['Drama','Comedy','Science Fiction']))],watchlist:[]});
 const taste=Rec.profile(data,genres);
 assert.equal(taste.seeds.length,4);
 assert.ok(taste.seeds.every(seed=>seed.tmdbId));
 assert.ok(taste.genreWeights.get(18)>taste.genreWeights.get(35));
 assert.equal(Rec.sources(taste).length,11);
});

test('selected moods override dominant inferred genres and filter every recommendation source',()=>{
 const names=new Map([[18,'Drama'],[878,'Science Fiction'],[35,'Comedy'],[27,'Horror']]);
 const data=Store.normalize({watched:Array.from({length:8},(_,i)=>film(i+1,5,['Drama','Science Fiction','Comedy'])),watchlist:[],favorites:['tmdb:1']});
 const taste=Rec.profile(data,names,[27]);
 assert.deepEqual(taste.genres.map(genre=>genre.id),[27]);
 assert.deepEqual(Rec.sources(taste).filter(source=>source.kind==='discover').map(source=>source.parameters.genre),['27']);
 const batches=Rec.sources(taste).map(source=>({...source,results:[candidate(100,[18]),candidate(101,[27]),candidate(102,[27,35])]}));
 assert.deepEqual(Rec.rank(data,taste,batches).map(movie=>movie.id).sort(),[101,102]);
 const cleared=Rec.profile(data,names);
 assert.ok(Rec.rank(data,cleared,batches).some(movie=>movie.id===100));
 const multi=Rec.profile(data,names,[27,35]);
 assert.deepEqual(Rec.rank(data,multi,[{...batches[0],results:[candidate(103,[35]),candidate(104,[27]),candidate(105,[18])]}]).map(movie=>movie.id).sort(),[103,104]);
});

test('More like this adds persistent seeds and reasons without marking a film watched',()=>{
 const data=Store.normalize({watched:[],watchlist:[]});
 Store.setFeedback(data,film(1,0,['Drama']),'moreLike');
 const taste=Rec.profile(data,genres);
 assert.equal(taste.seeds[0].tmdbId,1);
 assert.equal(taste.seeds[0].feedback,true);
 assert.equal(taste.genreWeights.get(18),6);
 const result=Rec.rank(data,taste,[{...Rec.sources(taste)[0],results:[candidate(2,[18])]}]);
 assert.match(result[0].recommendationReason,/asked for more like Film 1/);
 assert.equal(data.watched.length,0);
 const loaded=Store.load({getItem:key=>key===Store.KEY?JSON.stringify(data):null});
 assert.equal(Rec.profile(loaded,genres).seeds[0].tmdbId,1);
});

test('Not interested excludes a film from every source and Undo restores eligibility',()=>{
 const data=Store.normalize({watched:[film(1,5,['Drama'])],watchlist:[]});
 let taste=Rec.profile(data,genres);
 const batches=Rec.sources(taste).map(source=>({...source,results:[candidate(2,[18]),candidate(3,[18])]}));
 const token=Store.setFeedback(data,film(2),'dismissed');
 taste=Rec.profile(data,genres,[18]);
 assert.deepEqual(Rec.rank(data,taste,batches).map(movie=>movie.id),[3]);
 Store.undoFeedback(data,token);
 assert.ok(Rec.rank(data,taste,batches).some(movie=>movie.id===2));
});

test('direct More like this evidence outranks broad genre popularity and vanishes immediately on Undo',()=>{
 const data=Store.normalize({watched:Array.from({length:20},(_,i)=>film(i+1,5,['Drama'])),watchlist:[]});
 const token=Store.setFeedback(data,film(42,0,['Comedy']),'moreLike');
 const taste=Rec.profile(data,genres);
 const batches=Rec.sources(taste).map(source=>({...source,results:source.seed?.tmdbId===42?[candidate(101,[35]),candidate(101,[35]),candidate(42,[35])]:[candidate(102,[18])]}));
 const ranked=Rec.rank(data,taste,batches);
 assert.equal(ranked[0].id,101);
 assert.match(ranked[0].recommendationReason,/more like Film 42/);
 assert.equal(ranked.filter(movie=>movie.id===101).length,1);
 assert.ok(!ranked.some(movie=>movie.id===42));
 Store.undoFeedback(data,token);
 assert.ok(!Rec.rank(data,Rec.profile(data,genres),batches).some(movie=>movie.id===101));
 Store.setFeedback(data,film(42,0,['Comedy']),'moreLike');
 const first=Rec.profile(data,genres).seeds[0].weight;
 Store.setFeedback(data,film(42,0,['Comedy']),'moreLike');
 assert.equal(Rec.profile(data,genres).seeds[0].weight,first);
});
