const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium'].find(file => fs.existsSync(file));

test('all pages work without overflow or storage resets at phone, tablet and desktop widths', {skip: !chrome && 'Chrome is not installed'}, () => {
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'movielist-final-qa-'));
 try {
  const pages=['index.html','watched.html','watchlist.html','stats.html','recommendations.html'];
  for(const page of pages) {
   let html=fs.readFileSync(path.join(root,page),'utf8').replace(/(?:href|src)="(style.css|collection.js|recommendations.js|script.js)"/g,(match,file)=>match.replace(file,pathToFileURL(path.join(root,file)).href));
   const setup=`<script>
    window.errors=[];addEventListener('error',event=>errors.push(event.message));addEventListener('unhandledrejection',event=>errors.push(String(event.reason)));
    const film=id=>({id,tmdbId:id,title:id===5?'A very long film title to test card wrapping and consistent controls':'Film '+id,year:'1999',rating:id<=5?4.5:0,genres:['Drama'],overview:'A film description.',poster_path:null});
    const initial={watched:[1,2,3,4,5].map(film),watchlist:[6,7].map(film),favorites:[1,2,3,4].map(id=>'tmdb:'+id),recommendationFeedback:{dismissed:[999],moreLike:[]}};
    const before=JSON.stringify(initial);localStorage.setItem('movielist-v2',before);
    const raw=id=>({...film(id),release_date:'1999-01-01',genre_ids:[18]});
    window.fetch=async url=>{const params=new URL(url,location.href).searchParams;const action=params.get('action');return {ok:true,json:async()=>action==='genres'?{genres:[{id:18,name:'Drama'}]}:action==='details'?{...raw(Number(params.get('id'))),genres:[{id:18,name:'Drama'}],credits:{cast:[{id:7,name:'Test Person',character:'Hero'}],crew:[]}}:action==='person'?{id:7,name:'Test Person'}:action==='personCredits'?{cast:[raw(6)],crew:[]}:{results:[8,9,10,11].map(raw),total_pages:1}}};
   </script>`;
   const checks=`<script>
    addEventListener('load',async()=>{
     const failures=[],pause=()=>new Promise(resolve=>setTimeout(resolve,40));
     const check=(condition,message)=>{if(!condition)throw Error(message)};
     const click=selector=>{const node=document.querySelector(selector);check(node,'Missing '+selector);node.click();};
     const change=(selector,value)=>{const node=document.querySelector(selector);node.value=value;node.dispatchEvent(new Event('change'));};
     function geometry(label){
      check(document.documentElement.scrollWidth<=document.documentElement.clientWidth+1,label+' page overflows: '+document.documentElement.scrollWidth+'/'+document.documentElement.clientWidth);
      for(const node of document.querySelectorAll('dialog[open],.movie-card,.favorite-film'))check(node.scrollWidth<=node.clientWidth+1,label+' content overflow: '+node.className);
      const links=[...document.querySelectorAll('nav a')];for(let i=1;i<links.length;i++)check(links[i-1].getBoundingClientRect().right<=links[i].getBoundingClientRect().left+1||links[i-1].getBoundingClientRect().top<links[i].getBoundingClientRect().top,label+' nav overlaps');
     }
     try {
      await pause();geometry('initial');check(localStorage.getItem('movielist-v2')===before,'Initialization rewrote saved collection');
      check(document.querySelectorAll('nav a').length===5,'Navigation link count');
      check(document.querySelectorAll('nav [aria-current=page]').length===1,'Active navigation');
      check(!document.querySelector('input[type=date],#activity-timeline,#diary-dated'),'Retired UI found');
      if(document.getElementById('catalog-sort')) {
       change('#catalog-period','1980');change('#catalog-genre','18');change('#catalog-sort','vote_average.desc');await pause();
       document.getElementById('catalog-query').value='Example';document.getElementById('catalog-search').dispatchEvent(new Event('submit',{cancelable:true}));await pause();
       check(document.getElementById('catalog-sort').disabled,'Search sort should be disabled');
       click('#catalog-container .action-watchlist');click('#catalog-container .action-watched');click('#catalog-container .star-hit[aria-label="3.5 out of 5 stars"]');
       check(Store.find(collection,{tmdbId:8}).rating===3.5,'Rating did not update');
       click('#catalog-container .action-watchlist');click('#undo-action');check(Store.find(collection,{tmdbId:8}).rating===3.5,'Status Undo lost rating');
       geometry('Discover actions');
      }
      if(document.getElementById('favorites-container')) {
       const fifth=[...document.querySelectorAll('#movie-container .movie-card')].find(node=>node.movieKey==='tmdb:5');
       fifth.querySelector('.favorite-button').click();await pause();check(document.getElementById('favorite-dialog').matches(':modal'),'Top 4 replacement did not open');geometry('favorite modal');
       click('#favorite-replacements button');check(Store.isFavorite(collection,collection.watched.find(movie=>movie.tmdbId===5)),'Favorite replacement failed');
       click('#favorites-container .favorite-order button:nth-child(2)');
       check(collection.favorites.length===4,'Top 4 lost a favorite');
       document.getElementById('movie-search').value='no matching film';document.getElementById('movie-search').dispatchEvent(new Event('input'));await pause();
       check(!document.querySelector('#movie-container .movie-card'),'Saved search did not filter');
       document.getElementById('movie-search').value='';document.getElementById('movie-search').dispatchEvent(new Event('input'));await pause();geometry('Watched actions');
      }
      if(document.getElementById('pick-movie')) {
       click('#pick-movie');const first=pickedMovie.tmdbId;click('#pick-another');check(pickedMovie.tmdbId!==first,'Picker repeated');
       click('#picker-details');await pause();geometry('picker details');click('#close-dialog');await pause();
       const picked=pickedMovie.tmdbId;click('#picker-watched');click('#undo-action');check(pickedMovie.tmdbId===picked,'Picker Undo lost selection');geometry('Watchlist actions');
      }
      if(document.getElementById('statistics')) {
       check(document.getElementById('rated-count').textContent==='5','Rated count incorrect');
       click('#highest-rated .movie-open');await pause();click('#detail-content .star-hit[aria-label="5 out of 5 stars"]');
       check(document.getElementById('average-rating').textContent==='4.6','Statistics did not recalculate');geometry('stats details');click('#close-dialog');await pause();
      }
      if(document.getElementById('recommendation-container')) {
       check(document.querySelectorAll('#recommendation-container .movie-card').length===4,'Recommendations missing');
       click('#recommendation-container .action-watchlist');click('#recommendation-container .feedback-dismiss');await pause();
       check(document.querySelectorAll('#recommendation-container .movie-card').length===3,'Dismiss failed');click('#undo-action');await pause();
       check(document.querySelectorAll('#recommendation-container .movie-card').length===4,'Feedback Undo failed');
       click('#recommendation-container .feedback-more');await pause();geometry('related picks');click('#related-undo');await pause();geometry('For You actions');
      }
      check(collection.watched.length>=5,'Saved films were reset');check(collection.recommendationFeedback.dismissed.includes(999),'Old feedback lost');
      check(errors.length===0,'Runtime errors: '+errors.join('; '));
     }catch(error){failures.push(error.stack||error.message)}
     parent.postMessage({page:location.pathname.split('/').pop(),width:innerWidth,failures},'*');
    });
   </script>`;
   html=html.replace('</head>',setup+'</head>').replace('</body>',checks+'</body>');fs.writeFileSync(path.join(temp,page),html);
  }
  fs.writeFileSync(path.join(temp,'qa.html'),`<html><body><pre id="qa-result">pending</pre><script>
   const tasks=${JSON.stringify(pages.flatMap(page=>[320,375,768,1280].map(width=>({page,width}))))},results=[];let frame;
   function next(){if(!tasks.length){document.getElementById('qa-result').textContent=JSON.stringify(results);return}const task=tasks.shift();frame=document.createElement('iframe');frame.style.cssText='width:'+task.width+'px;height:900px;border:0';frame.src=task.page;document.body.append(frame)}
   addEventListener('message',event=>{if(event.source!==frame.contentWindow)return;results.push(event.data);frame.remove();next()});next();
  </script></body></html>`);
  const output=execFileSync(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--user-data-dir='+path.join(temp,'profile'),'--dump-dom','--virtual-time-budget=20000',pathToFileURL(path.join(temp,'qa.html')).href],{encoding:'utf8',timeout:60000,maxBuffer:6*1024*1024,stdio:['ignore','pipe','pipe']});
  const value=output.match(/<pre id="qa-result">([\s\S]*?)<\/pre>/)?.[1];assert.ok(value&&value!=='pending','Every page fixture must complete');
  const results=JSON.parse(value.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));assert.equal(results.length,20);
  const failures=results.flatMap(result=>result.failures.map(failure=>result.page+' @ '+result.width+': '+failure));assert.deepEqual(failures,[],failures.join('\n'));
 }finally{
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('movielist-final-qa-'))throw Error('Unsafe cleanup path');
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});
