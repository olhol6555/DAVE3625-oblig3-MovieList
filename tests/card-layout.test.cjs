const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { pathToFileURL } = require('node:url');
const { execFileSync } = require('node:child_process');
const root = path.join(__dirname, '..');
const chrome = ['C:/Program Files/Google/Chrome/Application/chrome.exe', 'C:/Program Files (x86)/Microsoft/Edge/Application/msedge.exe', '/usr/bin/chromium', '/usr/bin/google-chrome'].find(file => fs.existsSync(file));

test('real browser card geometry remains stable through status, favorites and half-star changes', { skip: !chrome && 'Chrome/Chromium is not installed' }, () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'movielist-card-layout-'));
  try {
    let html = fs.readFileSync(path.join(root, 'index.html'), 'utf8').replace(/(?:href|src)="(style.css|collection.js|script.js)"/g, (match, file) => match.replace(file, pathToFileURL(path.join(root, file)).href));
    const setup = `<script>
      localStorage.setItem('movielist-v2', JSON.stringify({watched:[],watchlist:[],favorites:[]}));
      window.fetch = async () => ({ok:true,json:async()=>({results:Array.from({length:4},(_,i)=>({id:i+1,title:i===1?'An unusually long movie title to exercise card text':'Movie '+(i+1),release_date:'1999-01-01',genre_ids:[18],poster_path:null})),total_pages:1,genres:[{id:18,name:'Drama'}]})});
    </script>`;
    const checks = `<script>
      addEventListener('load', async()=>{
        const failures=[];
        try {
          await new Promise(resolve=>setTimeout(resolve,30));
          const cards=[...document.querySelectorAll('#catalog-container .movie-card')];
          if(cards.length!==4)throw Error('Catalog did not initialize');
          const target=cards[0], controls=target.querySelector('.movie-controls');
          const watched=controls.querySelector('.action-watched'), watchlist=controls.querySelector('.action-watchlist'), favorite=controls.querySelector('.favorite-button');
          const stars=[...controls.querySelectorAll('.star-hit')];
          window.scrollTo({top:400,behavior:'instant'});
          const snapshot=()=>({heights:cards.map(card=>card.getBoundingClientRect().height),top:controls.getBoundingClientRect().top+scrollY,scroll:scrollY,posters:cards.map(card=>card.querySelector('.real-poster').getBoundingClientRect().height)});
          const baseline=snapshot();
          const check=label=>{
            const now=snapshot();
            now.heights.forEach((height,i)=>{if(Math.abs(height-baseline.heights[i])>1)failures.push(label+' card '+i+' height changed by '+(height-baseline.heights[i]).toFixed(2));});
            if(Math.abs(now.top-baseline.top)>1)failures.push(label+' controls moved');
            if(Math.abs(now.scroll-baseline.scroll)>1)failures.push(label+' viewport moved');
            now.posters.forEach((height,i)=>{if(Math.abs(height-baseline.posters[i])>1)failures.push(label+' poster changed');});
            for(const button of controls.querySelectorAll('button')) {
              if(getComputedStyle(button).visibility==='visible' && button.scrollWidth>button.clientWidth+1)failures.push(label+' button overflows: '+button.textContent.trim());
            }
          };
          watched.focus({preventScroll:true});watched.click();check('watched');
          favorite.click();check('favorited');
          for(const star of stars){star.click();check('rating '+star.getAttribute('aria-label'));}
          controls.querySelector('.clear-rating').click();check('clear rating');
          watchlist.click();check('watchlist removes favorite');
          document.getElementById('undo-action').click();check('undo restores watched');
          if(collection.watched[0]?.tmdbId!==1 || !Store.isFavorite(collection,catalog[0])) failures.push('Undo did not restore watched favorite');
          watchlist.click();check('watchlist after undo');
          watched.click();check('watched again');
          favorite.click();favorite.click();check('favorite removed');
          watched.click();check('neutral');
          if(innerWidth>=375){const row=cards.filter(card=>Math.abs(card.offsetTop-cards[0].offsetTop)<1);if(row.some(card=>Math.abs(card.getBoundingClientRect().height-row[0].getBoundingClientRect().height)>1))failures.push('Peer card heights differ');}
        }catch(error){failures.push(error.message);}
        parent.postMessage({width:innerWidth,failures},'*');
      });
    </script>`;
    html = html.replace('</head>', setup + '</head>').replace('</body>', checks + '</body>');
    fs.writeFileSync(path.join(temp, 'fixture.html'), html);
    fs.writeFileSync(path.join(temp, 'test.html'), `<html><body><pre id="layout-result">pending</pre><script>
      const results=[];
      addEventListener('message',event=>{results.push(event.data);if(results.length===4)document.getElementById('layout-result').textContent=JSON.stringify(results);});
      for(const width of [320,375,768,1280]){const frame=document.createElement('iframe');frame.style.width=width+'px';frame.style.height='900px';frame.style.border='0';frame.src='fixture.html';document.body.append(frame);}
    </script></body></html>`);
    const output = execFileSync(chrome, ['--headless=new', '--disable-gpu', '--no-first-run', '--disable-background-networking', '--user-data-dir=' + path.join(temp, 'profile'), '--dump-dom', '--virtual-time-budget=5000', pathToFileURL(path.join(temp, 'test.html')).href], { encoding:'utf8', timeout:45000, maxBuffer:4*1024*1024, stdio:['ignore','pipe','pipe'] });
    const value = output.match(/<pre id="layout-result">([\s\S]*?)<\/pre>/)?.[1];
    assert.ok(value && value !== 'pending', 'Browser layout fixture must complete');
    const results = JSON.parse(value.replaceAll('&amp;', '&').replaceAll('&lt;', '<').replaceAll('&gt;', '>'));
    assert.equal(results.length,4);
    for (const result of results) assert.deepEqual(result.failures, [], `Viewport ${result.width}: ${result.failures.join('; ')}`);
  } finally {
    // Only remove the unique test directory created under the OS temporary root.
    if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir()) || !path.basename(temp).startsWith('movielist-card-layout-')) throw Error('Unsafe test cleanup path');
    fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
  }
});

test('real browser More like this shows immediate related picks, loading and Undo without scrolling', {skip:!chrome&&'Chrome/Chromium is not installed'},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'movielist-related-browser-'));
 try {
  let html=fs.readFileSync(path.join(root,'recommendations.html'),'utf8').replace(/(?:href|src)="(style.css|collection.js|recommendations.js|script.js)"/g,(match,file)=>match.replace(file,pathToFileURL(path.join(root,file)).href));
  html=html.replace('</head>',`<script>
   const raw=(id,title)=>({id,title:title||'Related film '+id,release_date:'1999-01-01',genre_ids:[18],overview:'A saved movie description',poster_path:null});
   localStorage.setItem('movielist-v2',JSON.stringify({watched:[{id:1,title:'Seed',rating:5,genres:['Drama']}],watchlist:[],recommendationFeedback:{dismissed:[43],moreLike:[]}}));
   window.calls=[];window.pendingRelated=[];
   window.fetch=async url=>{
    const params=new URL(url,'http://localhost').searchParams;calls.push(Object.fromEntries(params));
    if(params.get('action')==='details')return {ok:true,json:async()=>({...raw(99),genres:[{id:18,name:'Drama'}]})};
    if(params.get('id')==='42')return new Promise(resolve=>pendingRelated.push({action:params.get('action'),resolve:()=>resolve({ok:true,json:async()=>({results:[raw(99),raw(100),raw(99),raw(1),raw(43),raw(42)]})})}));
    return {ok:true,json:async()=>({results:[raw(42,'Interstellar')]})};
   };
  </script></head>`);
  html=html.replace('</body>',`<script>
   addEventListener('load',async()=>{
    const failures=[];const check=(condition,message)=>{if(!condition)failures.push(message);};const pause=()=>new Promise(resolve=>setTimeout(resolve,30));
    try {
     await pause();window.scrollTo({top:400,behavior:'instant'});const original=scrollY;
     document.querySelector('#recommendation-container .feedback-more').click();
     check(document.getElementById('related-dialog').open,'Related dialog did not open');
     check(document.getElementById('related-title').textContent.includes('Interstellar'),'Source title missing');
     check(document.getElementById('related-container').getAttribute('aria-busy')==='true','Missing loading state');
     check(pendingRelated.length===2,'Both correct source endpoints were not requested immediately');
     pendingRelated.find(item=>item.action==='recommendations').resolve();await pause();
     check(document.querySelectorAll('#related-container .movie-card').length===2,'Related picks not visible incrementally or exclusions failed');
     check(document.getElementById('related-container').getAttribute('aria-busy')==='true','Second source should still be loading');
     check(document.querySelector('#recommendation-container .title-button').textContent==='Related film 99','Main feed did not prioritize related movie');
     pendingRelated.find(item=>item.action==='similar').resolve();await pause();
     check(document.querySelectorAll('#related-container .movie-card').length===2,'Related duplicates appeared');
     check(document.getElementById('related-container').getAttribute('aria-busy')==='false','Loading did not finish');
     check(Math.abs(scrollY-original)<1,'Feedback moved the background viewport');
     document.querySelector('#related-container .movie-open').click();await pause();
     check(document.getElementById('movie-dialog').open,'Existing details did not open');
     document.getElementById('close-dialog').click();
     document.getElementById('related-undo').click();await pause();
     check(!document.getElementById('related-dialog').open,'Undo did not close related panel');
     check(Store.feedback(collection).moreLike.length===0,'Undo did not remove feedback');
     check(![...document.querySelectorAll('#recommendation-container .title-button')].some(node=>node.textContent==='Related film 99'),'Undo left boosted source results visible');
     check(Math.abs(scrollY-original)<1,'Undo moved the background viewport');
     check(collection.watched[0].rating===5,'User rating was altered');
    } catch(error){failures.push(error.stack||error.message);}
    parent.postMessage({failures},'*');
   });
  </script></body>`);
  fs.writeFileSync(path.join(temp,'fixture.html'),html);
  fs.writeFileSync(path.join(temp,'test.html'),`<html><body><pre id="related-result">pending</pre><script>addEventListener('message',event=>document.getElementById('related-result').textContent=JSON.stringify(event.data));</script><iframe src="fixture.html" style="width:375px;height:900px;border:0"></iframe></body></html>`);
  const output=execFileSync(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--user-data-dir='+path.join(temp,'profile'),'--dump-dom','--virtual-time-budget=5000',pathToFileURL(path.join(temp,'test.html')).href],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  const value=output.match(/<pre id="related-result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(value&&value!=='pending','Browser interaction fixture must complete');
  const result=JSON.parse(value.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  assert.deepEqual(result.failures,[],result.failures.join('; '));
 } finally {
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('movielist-related-browser-'))throw Error('Unsafe test cleanup path');
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});

test('real browser person profiles work at mobile width and return films to existing details', {skip: !chrome && 'Chrome/Chromium is not installed'},()=>{
 const temp=fs.mkdtempSync(path.join(os.tmpdir(),'movielist-people-browser-'));
 try {
  let html=fs.readFileSync(path.join(root,'index.html'),'utf8').replace(/(?:href|src)="(style.css|collection.js|script.js)"/g,(match,file)=>match.replace(file,pathToFileURL(path.join(root,file)).href));
  html=html.replace('</head>',`<script>
   localStorage.setItem('movielist-v2',JSON.stringify({watched:[],watchlist:[]}));
   const film={id:42,title:'Profile film',release_date:'2001-01-01',genre_ids:[18]};
   const person={id:7,name:'Test Person',character:'Hero'};
   window.fetch=async url=>{const action=new URL(url,location.href).searchParams.get('action');return {ok:true,json:async()=>action==='details'?{...film,credits:{cast:[person],crew:[{...person,job:'Director'}]}}:action==='person'?{...person,biography:'Test biography'}:action==='personCredits'?{cast:[film,film],crew:[{...film,job:'Director'}]}:{results:[film],genres:[],total_pages:1}}};
  </script></head>`);
  html=html.replace('</body>',`<script>
   addEventListener('load',async()=>{
    const failures=[],pause=()=>new Promise(resolve=>setTimeout(resolve,30));
    const check=(condition,message)=>{if(!condition)throw Error(message)};
    try {
     await pause();document.querySelector('#catalog-container .movie-open').click();await pause();
     document.querySelector('.person-link').click();await pause();
     check(document.getElementById('person-dialog').matches(':modal'),'Person is not the active modal');
     check(document.querySelectorAll('.filmography').length===2,'Acting/directing sections missing');
     check(document.querySelectorAll('.person-films .movie-card').length===2,'Credits were not deduplicated');
     const dialog=document.getElementById('person-dialog');check(dialog.scrollWidth<=dialog.clientWidth+1,'Profile overflows mobile width');
     document.querySelector('.person-films .action-watched').click();await pause();
     check([...document.querySelectorAll('.filmography>.chart-note')].every(node=>node.textContent.startsWith('1 of 1')),'Counts did not synchronize');
     check([...document.querySelectorAll('.person-films .movie-card')].every(node=>node.dataset.watched==='true'),'Watched highlights missing');
     document.querySelector('.person-films .movie-open').click();await pause();
     check(!dialog.open&&document.getElementById('movie-dialog').matches(':modal'),'Film did not open existing movie dialog');
     check(collection.watched.length===1,'Duplicate saved movie');
     document.querySelector('.person-link').click();await pause();document.getElementById('close-person').click();await pause();
     check(document.getElementById('movie-dialog').matches(':modal'),'Close did not return to movie');
    }catch(error){failures.push(error.stack||error.message)}
    parent.postMessage({failures},'*');
   });
  </script></body>`);
  fs.writeFileSync(path.join(temp,'fixture.html'),html);
  fs.writeFileSync(path.join(temp,'test.html'),`<html><body><pre id="people-result">pending</pre><script>addEventListener('message',event=>document.getElementById('people-result').textContent=JSON.stringify(event.data));</script><iframe src="fixture.html" style="width:375px;height:900px;border:0"></iframe></body></html>`);
  const output=execFileSync(chrome,['--headless=new','--disable-gpu','--no-first-run','--disable-background-networking','--user-data-dir='+path.join(temp,'profile'),'--dump-dom','--virtual-time-budget=5000',pathToFileURL(path.join(temp,'test.html')).href],{encoding:'utf8',timeout:45000,maxBuffer:4*1024*1024,stdio:['ignore','pipe','pipe']});
  const value=output.match(/<pre id="people-result">([\s\S]*?)<\/pre>/)?.[1];
  assert.ok(value&&value!=='pending','Person fixture must complete');
  const result=JSON.parse(value.replaceAll('&amp;','&').replaceAll('&lt;','<').replaceAll('&gt;','>'));
  assert.deepEqual(result.failures,[],result.failures.join('; '));
 }finally{
  if(path.dirname(path.resolve(temp))!==path.resolve(os.tmpdir())||!path.basename(temp).startsWith('movielist-people-browser-'))throw Error('Unsafe cleanup path');
  fs.rmSync(temp,{recursive:true,force:true,maxRetries:5,retryDelay:200});
 }
});
